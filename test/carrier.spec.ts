import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { InvalidPackageDataError, Profile } from "../src/index.js";

type RequestCall = { method: string; url: string; data: any };

function packageResponse(
  trackingNumber: string,
  id: string,
  firstCarrier: number | null = 0,
  secondCarrier: number | null = 0,
) {
  return {
    Code: 0,
    Json: [
      {
        FTrackNo: trackingNumber,
        FTrackInfoId: id,
        FFirstCarrier: firstCarrier,
        FSecondCarrier: secondCarrier,
        FLastEvent: "",
      },
    ],
  };
}

function fakeProfile(responses: any[]): {
  profile: Profile;
  calls: RequestCall[];
} {
  const calls: RequestCall[] = [];
  const profile = new Profile(async (method, url, data) => {
    calls.push({ method, url, data });
    const response = responses.shift();
    assert.notStrictEqual(response, undefined, "unexpected request");
    return response;
  });
  return { profile, calls };
}

describe("carrier support", () => {
  it("parses carrier fields and normalizes null to zero", async () => {
    const { profile } = fakeProfile([
      packageResponse("TRACK-1", "id-1", 100778, null),
    ]);

    const [packageData] = await profile.packages();

    assert.equal(packageData.firstCarrier, 100778);
    assert.equal(packageData.secondCarrier, 0);
  });

  it("sets the carrier with the requested payload", async () => {
    const { profile, calls } = fakeProfile([{ Code: 0 }]);

    await profile.setCarrier("id-1", 100778, 0);

    assert.deepEqual(calls[0].data, {
      version: "1.0",
      method: "SetTrackCarrier",
      param: {
        TrackInfoId: "id-1",
        FirstCarrier: 100778,
        SecondCarrier: 0,
      },
    });
  });

  it("preserves an existing second carrier when omitted", async () => {
    const { profile, calls } = fakeProfile([
      packageResponse("TRACK-1", "id-1", 1, 222),
      { Code: 0 },
    ]);

    await profile.setCarrier("id-1", 100778);

    assert.equal(calls[1].data.param.SecondCarrier, 222);
  });

  it("finds archived packages by tracking number", async () => {
    const { profile, calls } = fakeProfile([
      { Code: 0, Json: [] },
      packageResponse("ARCHIVED", "archived-id", 1, 222),
      { Code: 0 },
    ]);

    await profile.setCarrierByTrackingNumber("ARCHIVED", 100778);

    assert.equal(calls[0].data.param.IsArchived, false);
    assert.equal(calls[1].data.param.IsArchived, true);
    assert.deepEqual(calls[2].data.param, {
      TrackInfoId: "archived-id",
      FirstCarrier: 100778,
      SecondCarrier: 222,
    });
  });

  it("rejects a second carrier without a first carrier", async () => {
    const { profile, calls } = fakeProfile([]);

    await assert.rejects(
      profile.setCarrier("id-1", 0, 222),
      InvalidPackageDataError,
    );
    assert.equal(calls.length, 0);
  });

  it("adds a package before looking it up and setting its carrier", async () => {
    const { profile, calls } = fakeProfile([
      { Code: 0 },
      packageResponse("TRACK-1", "id-1", null, 222),
      { Code: 0 },
    ]);

    await profile.addPackage("TRACK-1", undefined, { firstCarrier: 100778 });

    assert.deepEqual(
      calls.map((call) => call.data.method),
      ["AddTrackNo", "GetTrackInfoList", "SetTrackCarrier"],
    );
    assert.equal(calls[2].data.param.SecondCarrier, 222);
  });

  it("keeps friendly-name-only addPackage calls compatible", async () => {
    const { profile, calls } = fakeProfile([
      { Code: 0 },
      packageResponse("TRACK-1", "id-1"),
      { Code: 0 },
    ]);

    await profile.addPackage("TRACK-1", "My package");

    assert.deepEqual(
      calls.map((call) => call.data.method),
      ["AddTrackNo", "GetTrackInfoList", "SetTrackRemark"],
    );
    assert.deepEqual(calls[2].data.param, {
      TrackInfoId: "id-1",
      Remark: "My package",
    });
  });
});
