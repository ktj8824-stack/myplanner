import UIKit
import WebKit
import Capacitor
#if canImport(KakaoSDKAuth)
import KakaoSDKAuth
#endif

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        // 기본 CAPBridgeViewController 대신, 알림창을 안전하게 띄우는 MainViewController 사용
        window?.rootViewController = MainViewController()
        window?.makeKeyAndVisible()

        // 앱이 꺼진 상태에서 카카오 로그인·링크로 열렸을 때
        for ctx in connectionOptions.urlContexts { openURL(ctx.url) }
        if let activity = connectionOptions.userActivities.first { continueActivity(activity) }
    }

    // Capacitor에 URL·링크 전달 (이 Capacitor 버전에는 SceneDelegateProxy가 없어 직접 넘김)
    private func openURL(_ url: URL) {
        #if canImport(KakaoSDKAuth)
        // 카카오톡 앱으로 로그인하고 돌아온 경우 (카카오 공식 안내: SceneDelegate에서 처리)
        if AuthApi.isKakaoTalkLoginUrl(url) { _ = AuthController.handleOpenUrl(url: url); return }
        #endif
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, open: url, options: [:])
    }

    private func continueActivity(_ activity: NSUserActivity) {
        _ = ApplicationDelegateProxy.shared.application(UIApplication.shared, continue: activity, restorationHandler: { _ in })
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        for ctx in URLContexts { openURL(ctx.url) }
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        continueActivity(userActivity)
    }
}

// ─────────────────────────────────────────────────────────────
// 아래는 예전 MyPlanner-iOS의 MainViewController.swift 내용 (Xcode에 파일을 따로 등록하지 않도록 여기에 합침)

/// MyPlanner 메인 화면.
/// 웹 화면의 alert/confirm/prompt 창을 안전하게 띄우도록 Capacitor 기본 처리를 감쌉니다.
/// (기본 처리는 앞선 알림창이 닫히는 도중에 다음 창을 띄우면 앱이 종료되는 문제가 있음)
class MainViewController: CAPBridgeViewController {
    private var safeUIDelegate: SafeDialogUIDelegate?

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        guard let webView = webView else { return }
        let proxy = SafeDialogUIDelegate(original: webView.uiDelegate, host: self)
        safeUIDelegate = proxy
        webView.uiDelegate = proxy
    }
}

/// alert/confirm/prompt만 직접 처리하고 나머지 WKUIDelegate 기능은 Capacitor 원래 처리로 넘깁니다.
final class SafeDialogUIDelegate: NSObject, WKUIDelegate {
    private weak var original: WKUIDelegate?
    private weak var host: UIViewController?

    init(original: WKUIDelegate?, host: UIViewController) {
        self.original = original
        self.host = host
    }

    // 직접 구현하지 않은 메서드는 원래 delegate로 전달
    override func responds(to aSelector: Selector!) -> Bool {
        if super.responds(to: aSelector) { return true }
        return original?.responds(to: aSelector) ?? false
    }

    override func forwardingTarget(for aSelector: Selector!) -> Any? {
        if let original = original, original.responds(to: aSelector) { return original }
        return super.forwardingTarget(for: aSelector)
    }

    // MARK: - 알림창

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "확인", style: .default) { _ in completionHandler() })
        present(alert, fallback: completionHandler)
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let alert = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        alert.addAction(UIAlertAction(title: "취소", style: .cancel) { _ in completionHandler(false) })
        alert.addAction(UIAlertAction(title: "확인", style: .default) { _ in completionHandler(true) })
        present(alert, fallback: { completionHandler(false) })
    }

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String,
                 defaultText: String?, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (String?) -> Void) {
        // Capacitor 내부 신호({"type":"CapacitorCookies.isEnabled"} 등)는 창을 띄우지 말고 Capacitor 원래 처리로
        if prompt.hasPrefix("{"), prompt.contains("\"type\""),
           let orig = original,
           orig.responds(to: #selector(WKUIDelegate.webView(_:runJavaScriptTextInputPanelWithPrompt:defaultText:initiatedByFrame:completionHandler:))) {
            orig.webView?(webView, runJavaScriptTextInputPanelWithPrompt: prompt, defaultText: defaultText,
                          initiatedByFrame: frame, completionHandler: completionHandler)
            return
        }
        if prompt.hasPrefix("{"), prompt.contains("\"type\"") { completionHandler(nil); return }
        let alert = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
        alert.addTextField { $0.text = defaultText }
        alert.addAction(UIAlertAction(title: "취소", style: .cancel) { _ in completionHandler(nil) })
        alert.addAction(UIAlertAction(title: "확인", style: .default) { [weak alert] _ in
            completionHandler(alert?.textFields?.first?.text)
        })
        present(alert, fallback: { completionHandler(nil) })
    }

    // MARK: - 안전하게 띄우기

    /// 다른 창이 닫히는 중이면 잠시 기다렸다가 띄우고, 끝내 못 띄우면 fallback을 호출해
    /// WebKit의 completionHandler가 반드시 한 번은 불리게 합니다(안 불리면 앱 종료).
    private func present(_ alert: UIAlertController, fallback: @escaping () -> Void, attempt: Int = 0) {
        guard let base = host, base.viewIfLoaded?.window != nil else {
            if attempt < 20 {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { [weak self] in
                    guard let self = self else { fallback(); return }
                    self.present(alert, fallback: fallback, attempt: attempt + 1)
                }
            } else {
                fallback()
            }
            return
        }

        var top: UIViewController = base
        while let next = top.presentedViewController, !next.isBeingDismissed { top = next }

        let busy = top.isBeingDismissed || top.isBeingPresented
            || top.presentedViewController != nil || top is UIAlertController
        if busy {
            if attempt < 40 {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { [weak self] in
                    guard let self = self else { fallback(); return }
                    self.present(alert, fallback: fallback, attempt: attempt + 1)
                }
            } else {
                fallback()
            }
            return
        }
        top.present(alert, animated: true)
    }
}
