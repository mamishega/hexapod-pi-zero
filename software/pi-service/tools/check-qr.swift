// Developer check (Mac only): decodes QR codes made by live/qr.js with the macOS QR reader.
//   node tools/qr-sample.mjs /tmp/qr && swift tools/check-qr.swift /tmp/qr
import Foundation
import CoreImage
let dir = CommandLine.arguments[1]
let detector = CIDetector(ofType: CIDetectorTypeQRCode, context: nil, options: [CIDetectorAccuracy: CIDetectorAccuracyHigh])!
var failures = 0
for i in 0..<9 {
  let rows = try! String(contentsOfFile: "\(dir)/q\(i).txt", encoding: .utf8).split(separator: "\n").map { Array($0) }
  let expected = try! String(contentsOfFile: "\(dir)/t\(i).txt", encoding: .utf8)
  let n = rows.count, scale = 8, quiet = 4, size = (n + 2 * quiet) * scale
  var pixels = [UInt8](repeating: 255, count: size * size)
  for r in 0..<n { for c in 0..<n where rows[r][c] == "1" {
    for y in 0..<scale { for x in 0..<scale { pixels[((r + quiet) * scale + y) * size + (c + quiet) * scale + x] = 0 } } } }
  let provider = CGDataProvider(data: Data(pixels) as CFData)!
  let cg = CGImage(width: size, height: size, bitsPerComponent: 8, bitsPerPixel: 8, bytesPerRow: size, space: CGColorSpaceCreateDeviceGray(), bitmapInfo: CGBitmapInfo(rawValue: 0), provider: provider, decode: nil, shouldInterpolate: false, intent: .defaultIntent)!
  let found = detector.features(in: CIImage(cgImage: cg)).compactMap { ($0 as? CIQRCodeFeature)?.messageString }
  let ok = found.first == expected
  if !ok { failures += 1 }
  print(i, ok ? "OK  " : "FAIL", "decoded:", found.first.map { String($0.prefix(50)) } ?? "nothing")
}
print(failures == 0 ? "ALL DECODED CORRECTLY" : "\(failures) FAILED")
