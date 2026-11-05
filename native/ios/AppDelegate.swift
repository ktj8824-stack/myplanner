import UIKit
import Capacitor

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        AppDelegate.installAlarmSound()
        return true
    }

    /// 알람 음악(mp_alarm.caf, 30초 이하)을 Library/Sounds로 복사.
    /// 아이폰 알림은 앱 묶음의 맨 위나 Library/Sounds에 있는 소리만 쓸 수 있는데,
    /// 웹 파일(public/) 안에 들어 있어서 여기로 옮겨 둡니다.
    static func installAlarmSound() {
        let fm = FileManager.default
        guard let src = Bundle.main.url(forResource: "mp_alarm", withExtension: "caf", subdirectory: "public")
                ?? Bundle.main.url(forResource: "mp_alarm", withExtension: "caf"),
              let lib = fm.urls(for: .libraryDirectory, in: .userDomainMask).first else { return }
        let dir = lib.appendingPathComponent("Sounds", isDirectory: true)
        let dst = dir.appendingPathComponent("mp_alarm.caf")
        do {
            try fm.createDirectory(at: dir, withIntermediateDirectories: true)
            if fm.fileExists(atPath: dst.path) { try fm.removeItem(at: dst) }
            try fm.copyItem(at: src, to: dst)
        } catch {
            print("[MyPlanner] 알람 음악 복사 실패: \(error)")
        }
    }

    func application(_ application: UIApplication,
                     configurationForConnecting connectingSceneSession: UISceneSession,
                     options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let config = UISceneConfiguration(name: "Default Configuration",
                                          sessionRole: connectingSceneSession.role)
        config.delegateClass = SceneDelegate.self
        return config
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }
}
