import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        let paper = UIColor(red: 247 / 255, green: 243 / 255, blue: 234 / 255, alpha: 1)
        // Use the app's bridge subclass so local native plugins (including
        // direct saving to Apple Photos) are registered before the web UI loads.
        let bridgeViewController = FamilyBridgeViewController()
        bridgeViewController.view.backgroundColor = paper
        bridgeViewController.webView?.backgroundColor = paper
        bridgeViewController.webView?.scrollView.backgroundColor = paper
        window = UIWindow(windowScene: windowScene)
        window?.backgroundColor = paper
        window?.rootViewController = bridgeViewController
        window?.makeKeyAndVisible()

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
