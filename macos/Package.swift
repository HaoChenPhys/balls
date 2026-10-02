// swift-tools-version:5.9
// Ball on a String, macOS platform layer. Build with ./build.sh (which also
// assembles the .app bundle), or `swift run` for a quick development start.
import PackageDescription

let package = Package(
    name: "BallOnAString",
    platforms: [.macOS(.v14)],
    targets: [
        .executableTarget(
            name: "BallOnAString",
            path: "Sources/BallOnAString",
            linkerSettings: [
                .linkedFramework("AppKit"),
                .linkedFramework("SwiftUI"),
                .linkedFramework("JavaScriptCore"),
                .linkedFramework("QuartzCore"),
            ]
        ),
        .testTarget(
            name: "BallOnAStringTests",
            dependencies: ["BallOnAString"],
            path: "Tests/BallOnAStringTests"
        ),
    ]
)
