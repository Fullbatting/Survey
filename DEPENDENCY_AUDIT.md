# Dependency and license audit — initial MVP

Date: 2026-10-15

- [x] No npm package dependencies declared.
- [x] No external JavaScript/CSS framework included.
- [x] Vendored browser libraries, copied unmodified from their npm packages:
  - `qrcode-generator` 2.0.4 (MIT) at `public/vendor/qrcode.js`. License text in `THIRD_PARTY_LICENSES.md`.
  - `jsQR` 1.4.0 (Apache-2.0) at `public/vendor/jsQR.js`. License text in `licenses/jsQR-LICENSE.txt`.
- [x] No remote fonts, analytics, or third-party assets.
- [ ] Verify the exact Node.js runtime release and its bundled third-party notices before any redistribution.
- [ ] Re-run license/security review when dependencies are introduced.

Scope note: this is a source-level dependency inventory, not legal advice or a full audit of the Node.js runtime distribution.
