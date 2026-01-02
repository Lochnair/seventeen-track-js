# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.0.0] - 2026-01-02

### Added

- **RSA Encryption**: Implemented password encryption using `node-forge` to comply with the updated 17track authentication API.
- **Node-Forge Dependency**: Added for pure-JavaScript crypto support in non-Node environments (Google Apps Script).
- **ES Modules Support**: Added `"type": "module"` to `package.json` for modern Node.js support.
- **Detailed Debug Logging**: Re-implemented request/response logging under the `seventeen-track` namespace (enabled via `NODE_DEBUG=seventeen-track`).

### Changed

- **New Login Flow**: Updated authentication to use the `sign-in-by-password` endpoint.
- **Build System**: Switched from Rollup to **esbuild** for faster and more reliable bundling, especially with CommonJS dependencies.
- **Header Mimicry**: Added standard browser headers (`User-Agent`, `Referer`) to avoid API blocks.
- **Universal Fix**: Standardized error code handling across different 17track API versions (case-insensitive `code` field).
- **Import Style**: Updated codebase to use explicit `.js` extensions for ESM compatibility.

### Fixed

- **Authentication Failures**: Resolved "System Error -11" caused by the deprecated login API.
- **Package Fetching**: Fixed issues with package list retrieval following upstream API changes.
