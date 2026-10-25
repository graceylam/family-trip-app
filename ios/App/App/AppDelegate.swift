import UIKit
import Capacitor
import Photos
import QuickLook

@objc(NativeSharePlugin)
public class NativeSharePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativeSharePlugin"
    public let jsName = "NativeShare"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "shareBase64", returnType: CAPPluginReturnPromise)
    ]

    private var sharedURL: URL?

    @objc func shareBase64(_ call: CAPPluginCall) {
        guard let encoded = call.getString("data"), let data = Data(base64Encoded: encoded) else {
            call.reject("The PDF could not be read.")
            return
        }
        let suppliedName = call.getString("name") ?? "Zora Photobook.pdf"
        let safeName = URL(fileURLWithPath: suppliedName).lastPathComponent
        let fileName = safeName.isEmpty ? "Zora Photobook.pdf" : safeName
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("zora-\(UUID().uuidString)-\(fileName)")

        do {
            try data.write(to: url, options: .atomic)
        } catch {
            call.reject("The PDF could not be prepared for sharing.", nil, error)
            return
        }

        DispatchQueue.main.async { [weak self] in
            guard let self, let presenter = self.bridge?.viewController else {
                try? FileManager.default.removeItem(at: url)
                call.reject("The iPhone Share Sheet is unavailable.")
                return
            }
            if let previousURL = self.sharedURL { try? FileManager.default.removeItem(at: previousURL) }
            self.sharedURL = url
            let share = UIActivityViewController(activityItems: [url], applicationActivities: nil)
            if let popover = share.popoverPresentationController {
                popover.sourceView = presenter.view
                popover.sourceRect = CGRect(x: presenter.view.bounds.midX, y: presenter.view.bounds.midY, width: 1, height: 1)
            }
            share.completionWithItemsHandler = { [weak self] _, completed, _, _ in
                try? FileManager.default.removeItem(at: url)
                self?.sharedURL = nil
                call.resolve(["shared": completed])
            }
            presenter.present(share, animated: true)
        }
    }
}

@objc(NativeDocumentsPlugin)
public class NativeDocumentsPlugin: CAPPlugin, CAPBridgedPlugin, QLPreviewControllerDataSource {
    public let identifier = "NativeDocumentsPlugin"
    public let jsName = "NativeDocuments"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "previewBase64", returnType: CAPPluginReturnPromise)
    ]

    private var previewURL: URL?

    @objc func previewBase64(_ call: CAPPluginCall) {
        guard let encoded = call.getString("data"), let data = Data(base64Encoded: encoded) else {
            call.reject("The document could not be read.")
            return
        }
        let suppliedName = call.getString("name") ?? "Trip document"
        let safeName = URL(fileURLWithPath: suppliedName).lastPathComponent
        let fileName = safeName.isEmpty ? "Trip document" : safeName
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("family-trip-\(UUID().uuidString)-\(fileName)")

        do {
            try data.write(to: url, options: .atomic)
        } catch {
            call.reject("The document could not be prepared for viewing.", nil, error)
            return
        }

        DispatchQueue.main.async { [weak self] in
            guard let self, let presenter = self.bridge?.viewController else {
                try? FileManager.default.removeItem(at: url)
                call.reject("The document viewer is unavailable.")
                return
            }
            if let previousURL = self.previewURL { try? FileManager.default.removeItem(at: previousURL) }
            self.previewURL = url
            let preview = QLPreviewController()
            preview.dataSource = self
            preview.navigationItem.leftBarButtonItem = UIBarButtonItem(barButtonSystemItem: .done, target: self, action: #selector(self.closePreview))
            let navigation = UINavigationController(rootViewController: preview)
            navigation.modalPresentationStyle = .fullScreen
            presenter.present(navigation, animated: true) {
                call.resolve(["opened": true])
            }
        }
    }

    public func numberOfPreviewItems(in controller: QLPreviewController) -> Int {
        previewURL == nil ? 0 : 1
    }

    public func previewController(_ controller: QLPreviewController, previewItemAt index: Int) -> QLPreviewItem {
        previewURL! as NSURL
    }

    @objc private func closePreview() {
        bridge?.viewController?.presentedViewController?.dismiss(animated: true) { [weak self] in
            guard let self else { return }
            if let url = self.previewURL { try? FileManager.default.removeItem(at: url) }
            self.previewURL = nil
        }
    }
}

@objc(NativePhotosPlugin)
public class NativePhotosPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "NativePhotosPlugin"
    public let jsName = "NativePhotos"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "saveFromUrl", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveBase64", returnType: CAPPluginReturnPromise)
    ]

    @objc func saveFromUrl(_ call: CAPPluginCall) {
        guard let value = call.getString("url"), let remoteURL = URL(string: value) else {
            call.reject("The photo address is invalid.")
            return
        }
        let mimeType = call.getString("mimeType") ?? "image/jpeg"
        URLSession.shared.downloadTask(with: remoteURL) { [weak self] downloadedURL, _, error in
            guard let self else { return }
            if let error {
                call.reject("The memory could not be downloaded.", nil, error)
                return
            }
            guard let downloadedURL else {
                call.reject("The memory could not be downloaded.")
                return
            }
            do {
                let localURL = try self.copyToTemporaryFile(downloadedURL, mimeType: mimeType)
                self.saveFile(localURL, mimeType: mimeType, call: call)
            } catch {
                call.reject("The memory could not be prepared for Photos.", nil, error)
            }
        }.resume()
    }

    @objc func saveBase64(_ call: CAPPluginCall) {
        guard let encoded = call.getString("data"), let data = Data(base64Encoded: encoded) else {
            call.reject("The selected memory could not be read.")
            return
        }
        let mimeType = call.getString("mimeType") ?? "image/jpeg"
        do {
            let localURL = temporaryURL(mimeType: mimeType)
            try data.write(to: localURL, options: .atomic)
            saveFile(localURL, mimeType: mimeType, call: call)
        } catch {
            call.reject("The memory could not be prepared for Photos.", nil, error)
        }
    }

    private func saveFile(_ fileURL: URL, mimeType: String, call: CAPPluginCall) {
        let performSave = {
            PHPhotoLibrary.shared().performChanges {
                if mimeType.hasPrefix("video/") {
                    PHAssetChangeRequest.creationRequestForAssetFromVideo(atFileURL: fileURL)
                } else {
                    PHAssetChangeRequest.creationRequestForAssetFromImage(atFileURL: fileURL)
                }
            } completionHandler: { success, error in
                try? FileManager.default.removeItem(at: fileURL)
                if success {
                    call.resolve(["saved": true])
                } else {
                    call.reject("The memory could not be saved to Photos.", nil, error)
                }
            }
        }

        if #available(iOS 14, *) {
            let status = PHPhotoLibrary.authorizationStatus(for: .addOnly)
            if status == .authorized || status == .limited {
                performSave()
            } else if status == .notDetermined {
                PHPhotoLibrary.requestAuthorization(for: .addOnly) { nextStatus in
                    if nextStatus == .authorized || nextStatus == .limited {
                        performSave()
                    } else {
                        try? FileManager.default.removeItem(at: fileURL)
                        call.reject("Photos access was not allowed. You can enable it in iPhone Settings.")
                    }
                }
            } else {
                try? FileManager.default.removeItem(at: fileURL)
                call.reject("Photos access is turned off. Enable it in iPhone Settings to save memories.")
            }
        } else {
            PHPhotoLibrary.requestAuthorization { status in
                if status == .authorized { performSave() }
                else {
                    try? FileManager.default.removeItem(at: fileURL)
                    call.reject("Photos access was not allowed.")
                }
            }
        }
    }

    private func copyToTemporaryFile(_ source: URL, mimeType: String) throws -> URL {
        let destination = temporaryURL(mimeType: mimeType)
        try FileManager.default.copyItem(at: source, to: destination)
        return destination
    }

    private func temporaryURL(mimeType: String) -> URL {
        let ext: String
        switch mimeType.lowercased() {
        case "image/png": ext = "png"
        case "image/heic", "image/heif": ext = "heic"
        case "video/quicktime": ext = "mov"
        case let value where value.hasPrefix("video/"): ext = "mp4"
        default: ext = "jpg"
        }
        return FileManager.default.temporaryDirectory.appendingPathComponent("family-trip-\(UUID().uuidString).\(ext)")
    }
}

@objc(FamilyBridgeViewController)
public class FamilyBridgeViewController: CAPBridgeViewController {
    override public func viewDidLoad() {
        super.viewDidLoad()
        edgesForExtendedLayout = .all
        extendedLayoutIncludesOpaqueBars = true
        webView?.scrollView.contentInsetAdjustmentBehavior = .never
    }

    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(NativePhotosPlugin())
        bridge?.registerPluginInstance(NativeDocumentsPlugin())
        bridge?.registerPluginInstance(NativeSharePlugin())
    }
}

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Override point for customization after application launch.
        return true
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }
}
