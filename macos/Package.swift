// swift-tools-version: 5.9
import PackageDescription
let package = Package(name: "Sensebook", platforms: [.macOS(.v13)], products: [.executable(name: "Sensebook", targets: ["Sensebook"])], targets: [.executableTarget(name: "Sensebook"), .testTarget(name: "SensebookTests", dependencies: ["Sensebook"])])
