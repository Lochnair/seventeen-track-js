import forge from "node-forge";
import { Package, packageStatusMap, PackageStatus } from "./package.js";

const API_URL_BUYER: string = "https://buyer.17track.net/orderapi/call";
const API_URL_USER: string =
  "https://user.17track.net/user-api/v1/sign-in-by-password";

const PUBLIC_KEY: string = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA0Y5iQN3VNofXPtZXYZe9
75ojD+Gb+yPBrlrKj2t4XvYHE+pYmFzGPTvDmB3t1OfHujdgBVc3VJBSFsHezm4kz
4iqIChHLKeFvuux+i/Uq+zo1QdC72qteUMHF925qPLe3xU/QJj6BFR9mA4VrUwXt8
eWI58ozizBH31PclxiPNT+yYYXRUV3QJvbZ+FJGL3gYUu1k44WILQzDZfBJMRf+My
LHZew6+XtYB8E2+PXc/R7TtLPcMDsPvARrAJMhu5b+yfwJM1zOFChAz3U1w0Zkj1y
VJQaa/aktmfd0KyFkU2M0xNpPIIcQkywUGCMZEmJkEIyyV/I+H/NvQ+qqU5llwIDAQAB
-----END PUBLIC KEY-----`;

export class RequestError extends Error {}
export class InvalidTrackingNumberError extends Error {}

export class Profile {
  private request: (method: string, url: string, data?: any) => Promise<any>;
  public accountId?: string;

  constructor(
    request: (method: string, url: string, data?: any) => Promise<any>
  ) {
    this.request = request;
  }

  private rsaEncrypt(text: string): string {
    const publicKey = forge.pki.publicKeyFromPem(PUBLIC_KEY);
    const encrypted = publicKey.encrypt(text, "RSAES-PKCS1-V1_5");
    return forge.util.encode64(encrypted);
  }

  async login(email: string, password: string): Promise<boolean> {
    const encryptedPassword = this.rsaEncrypt(password);
    const loginResp = await this.request("post", API_URL_USER, {
      source: 0,
      account: email,
      password: encryptedPassword,
    });

    if (loginResp.code !== 0) {
      return false;
    }

    this.accountId = loginResp.data?.gid;
    return true;
  }

  async packages(
    packageState: number | string = "",
    showArchived: boolean = false,
    tz: string = "UTC"
  ): Promise<Package[]> {
    const packagesResp = await this.request("post", API_URL_BUYER, {
      version: "1.0",
      method: "GetTrackInfoList",
      param: {
        IsArchived: showArchived,
        Item: "",
        Page: 1,
        PerPage: 40,
        PackageState: packageState,
        Sequence: "0",
      },
      sourcetype: 0,
    });

    if (packagesResp.Code !== 0) {
      throw new RequestError(
        `Non-zero status code in response: ${packagesResp.Code}`
      );
    }

    const packages: Package[] = [];
    for (const packageData of packagesResp.Json || []) {
      let event: { [key: string]: any } = {};
      const lastEventRaw: string = packageData.FLastEvent;
      if (lastEventRaw) {
        event = JSON.parse(lastEventRaw);
      }

      const options = {
        id: packageData.FTrackInfoId,
        destinationCountry: packageData.FSecondCountry ?? 0,
        friendlyName: packageData.FRemark,
        infoText: event.z,
        location: `${event.c ?? ""} ${event.d ?? ""}`.trim(),
        timestamp: event.a,
        tz: tz,
        originCountry: packageData.FFirstCountry ?? 0,
        packageType: packageData.FTrackStateType ?? 0,
        status: packageData.FPackageState ?? 0,
      };
      packages.push(new Package(packageData.FTrackNo, options));
    }
    return packages;
  }

  async summary(
    showArchived: boolean = false
  ): Promise<Record<string, number>> {
    const summaryResp = await this.request("post", API_URL_BUYER, {
      version: "1.0",
      method: "GetIndexData",
      param: { IsArchived: showArchived },
      sourcetype: 0,
    });

    const results: Record<string, number> = {};
    for (const kind of summaryResp.Json?.eitem || []) {
      const key = packageStatusMap[kind.e] || PackageStatus.Unknown;
      const value = kind.ec;
      results[key] = key in results ? results[key] + value : value;
    }
    return results;
  }

  async addPackage(
    trackingNumber: string,
    friendlyName?: string
  ): Promise<void> {
    const addResp = await this.request("post", API_URL_BUYER, {
      version: "1.0",
      method: "AddTrackNo",
      param: { TrackNos: [trackingNumber] },
    });

    const code = addResp.Code;
    if (code !== 0) {
      throw new RequestError(`Non-zero status code in response: ${code}`);
    }

    if (!friendlyName) {
      return;
    }

    const packages = await this.packages();
    try {
      const newPackage = packages.find(
        (p) => p.trackingNumber === trackingNumber
      );
      if (!newPackage) {
        throw new InvalidTrackingNumberError(
          `Recently added package not found by tracking number: ${trackingNumber}`
        );
      }

      await this.setFriendlyName(newPackage.id!, friendlyName);
    } catch (err) {
      if (err instanceof InvalidTrackingNumberError) {
        throw err;
      }
      console.error("Unexpected error setting the friendly name", err);
    }
  }

  async setFriendlyName(
    internalId: string,
    friendlyName: string
  ): Promise<void> {
    const remarkResp = await this.request("post", API_URL_BUYER, {
      version: "1.0",
      method: "SetTrackRemark",
      param: { TrackInfoId: internalId, Remark: friendlyName },
    });

    const code = remarkResp.Code;
    if (code !== 0) {
      throw new RequestError(`Non-zero status code in response: ${code}`);
    }
  }

  async archivePackage(trackingNumber: string): Promise<void> {
    const packages = await this.packages();
    const packageToArchive = packages.find(
      (p) => p.trackingNumber === trackingNumber
    );

    if (!packageToArchive) {
      throw new InvalidTrackingNumberError(
        `Package not found by tracking number: ${trackingNumber}`
      );
    }

    const internalId = packageToArchive.id;
    if (!internalId) {
      throw new Error("Package Id is undefined, cannot archive");
    }

    const archiveResp = await this.request("post", API_URL_BUYER, {
      version: "1.0",
      method: "SetTrackArchived",
      param: { TrackInfoIds: [internalId] },
    });

    const code = archiveResp.Code;
    if (code !== 0) {
      throw new RequestError(`Non-zero status code in response: ${code}`);
    }
  }

  async deletePackage(trackingNumber: string): Promise<void> {
    const packages = await this.packages();
    const packageToDelete = packages.find(
      (p) => p.trackingNumber === trackingNumber
    );
    if (!packageToDelete) {
      throw new InvalidTrackingNumberError(
        `Package not found by tracking number: ${trackingNumber}`
      );
    }

    const internalId = packageToDelete.id;
    if (!internalId) {
      throw new Error("Package Id is undefined, cannot delete");
    }

    const deleteResp = await this.request("post", API_URL_BUYER, {
      version: "1.0",
      method: "DelTrackNo",
      param: { TrackInfoIds: [internalId] },
    });

    const code = deleteResp.Code;
    if (code !== 0) {
      throw new RequestError(`Non-zero status code in response: ${code}`);
    }
  }
}
