# Third-party license inventory

## Application dependencies

- npm packages: none
- Third-party frontend JavaScript: `qrcode-generator` 2.0.4 (MIT), vendored as `public/vendor/qrcode.js`
- Third-party frontend JavaScript: `jsQR` 1.4.0 (Apache-2.0), vendored as `public/vendor/jsQR.js`
- Third-party CSS: none
- External fonts/assets: none

The application uses Node.js built-in modules (`node:http`, `node:fs`, `node:path`, `node:crypto`). Node.js itself is a separately distributed runtime with its own license and bundled third-party notices. This inventory covers the application source, not the full Node.js distribution.

## qrcode-generator 2.0.4

Source: https://github.com/kazuhikoarase/qrcode-generator (npm `qrcode-generator@2.0.4`, file `dist/qrcode.js`, unmodified)

```
MIT License

Copyright (c) 2009 Kazuhiko Arase

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

The word "QR Code" is a registered trademark of DENSO WAVE INCORPORATED.

## jsQR 1.4.0

Source: https://github.com/cozmo/jsQR (npm `jsqr@1.4.0`, file `dist/jsQR.js`, unmodified). Used to read answer QR codes from the camera or an image on the admin PC.

Licensed under the Apache License, Version 2.0. The full license text is in `licenses/jsQR-LICENSE.txt`. The package ships no NOTICE file.

## License policy

The project target is MIT or Apache-2.0 for third-party components. Before redistributing a packaged runtime or deploying a production build, review the exact Node.js release's license and bundled third-party notices. Do not assume that “no npm dependencies” means the entire runtime distribution contains only MIT/Apache-2.0 material.
