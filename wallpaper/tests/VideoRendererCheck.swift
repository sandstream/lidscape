import AVFoundation
import CoreMedia
import CoreVideo
import QuartzCore

@main
struct VideoRendererCheck {
    @MainActor
    static func main() async throws {
        DispatchQueue.global().asyncAfter(deadline: .now() + 30) {
            fputs("Video renderer did not complete the test in time\n", stderr)
            exit(1)
        }
        guard CommandLine.arguments.count == 2 else {
            fatalError("Pass a path for the temporary video")
        }
        let videoURL = URL(fileURLWithPath: CommandLine.arguments[1])
        try await makeVideo(at: videoURL)

        let root = CALayer()
        root.frame = CGRect(x: 0, y: 0, width: 128, height: 72)
        let layer = AVSampleBufferDisplayLayer()
        root.addSublayer(layer)
        guard let context = CGContext(
            data: nil,
            width: 128,
            height: 72,
            bitsPerComponent: 8,
            bytesPerRow: 0,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else { fatalError("Cannot create the poster context") }
        context.setFillColor(CGColor(red: 1, green: 0, blue: 0, alpha: 1))
        context.fill(CGRect(x: 0, y: 0, width: 128, height: 72))
        guard let poster = context.makeImage() else { fatalError("Cannot create the poster") }
        let video = try await VideoRenderer.create(
            rootLayer: root,
            videoURL: videoURL,
            stillImage: poster,
            reusingDisplayLayer: layer
        )
        precondition(layer.videoGravity == .resizeAspectFill)
        precondition(layer.frame == root.bounds)
        precondition(layer.controlTimebase === video.timebase)

        let firstFrame = await withCheckedContinuation { continuation in
            video.start(
                onFirstFrameProcessed: { continuation.resume(returning: $0) },
                requiresVisibleRendering: false
            )
        }
        precondition(firstFrame, "The video must produce a decoded frame")
        try await Task.sleep(nanoseconds: 400_000_000)
        let played = CMTimeGetSeconds(CMTimebaseGetTime(video.timebase))
        precondition(played > 0.1, "Playback must advance")

        video.applyPolicy(.paused)
        try await Task.sleep(nanoseconds: 150_000_000)
        let stopped = CMTimeGetSeconds(CMTimebaseGetTime(video.timebase))
        try await Task.sleep(nanoseconds: 150_000_000)
        let afterPause = CMTimeGetSeconds(CMTimebaseGetTime(video.timebase))
        precondition(abs(afterPause - stopped) < 0.05, "Playback must pause")

        video.applyPolicy(.full)
        try await Task.sleep(nanoseconds: 200_000_000)
        let afterResume = CMTimeGetSeconds(CMTimebaseGetTime(video.timebase))
        precondition(afterResume > stopped + 0.1, "Playback must resume")
        video.stop(preservingDisplayLayer: true)

        let missingVideo = videoURL.deletingLastPathComponent().appendingPathComponent("missing.mp4")
        do {
            _ = try await VideoRenderer.create(
                rootLayer: root,
                videoURL: missingVideo,
                reusingDisplayLayer: layer
            )
            fatalError("A missing video must report an error")
        } catch {
            print("Video renderer configure, decode, pause, resume and missing file: OK")
        }
    }

    private static func makeVideo(at url: URL) async throws {
        let writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
        let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
            AVVideoCodecKey: AVVideoCodecType.h264,
            AVVideoWidthKey: 128,
            AVVideoHeightKey: 72,
        ])
        let adaptor = AVAssetWriterInputPixelBufferAdaptor(
            assetWriterInput: input,
            sourcePixelBufferAttributes: [
                kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB,
                kCVPixelBufferWidthKey as String: 128,
                kCVPixelBufferHeightKey as String: 72,
            ]
        )
        precondition(writer.canAdd(input))
        writer.add(input)
        precondition(writer.startWriting())
        writer.startSession(atSourceTime: .zero)
        for frame in 0..<24 {
            while !input.isReadyForMoreMediaData {
                guard writer.status == .writing else {
                    throw writer.error ?? CocoaError(.fileWriteUnknown)
                }
                try await Task.sleep(nanoseconds: 10_000_000)
            }
            var pixelBuffer: CVPixelBuffer?
            let result = CVPixelBufferCreate(
                kCFAllocatorDefault, 128, 72, kCVPixelFormatType_32ARGB,
                nil, &pixelBuffer
            )
            precondition(result == kCVReturnSuccess)
            guard let pixelBuffer else { fatalError("Cannot create a video frame") }
            CVPixelBufferLockBaseAddress(pixelBuffer, [])
            guard let baseAddress = CVPixelBufferGetBaseAddress(pixelBuffer) else {
                fatalError("Cannot access a video frame")
            }
            memset(baseAddress, Int32(frame * 8), CVPixelBufferGetDataSize(pixelBuffer))
            CVPixelBufferUnlockBaseAddress(pixelBuffer, [])
            let time = CMTime(value: CMTimeValue(frame), timescale: 12)
            precondition(adaptor.append(pixelBuffer, withPresentationTime: time))
        }
        input.markAsFinished()
        await writer.finishWriting()
        guard writer.status == .completed else {
            throw writer.error ?? CocoaError(.fileWriteUnknown)
        }
    }
}
