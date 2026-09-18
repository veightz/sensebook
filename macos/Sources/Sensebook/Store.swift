import SwiftUI
import AppKit

@MainActor final class Store: ObservableObject {
    @Published var text = ""
    @Published var context = ""
    @Published var source = "手动输入"
    @Published var result = ""
    @Published var message = ""
    @Published var busy = false
    @Published var syncing = false
    @Published var tab = "translate"
    @Published var mode = "sense"
    @Published var pinned = false
    @Published var model = ModelConfig()
    @Published var key = ""
    @Published var deviceText = ""
    @Published var connection: DeviceConfig?
    @Published var followModel = true
    @Published var syncRecords = false
    @Published var includeHistory = false
    @Published var events: [QueryEvent] = []
    @Published var search = ""
    @Published var modelName = "本机模型"
    @Published var syncMessage = "未连接账号 · 所有查询保存在这台 Mac"
    var task: Task<Void, Never>?
    let folder: URL
    let installation: String
    private var since: String
    private var generation = UUID()
    private var timer: Timer?
    private var historyWritable = true
    init() {
        folder = FileManager.default.urls(for:.applicationSupportDirectory,in:.userDomainMask)[0].appendingPathComponent("Sensebook")
        installation = UserDefaults.standard.string(forKey:"installation") ?? UUID().uuidString
        since = UserDefaults.standard.string(forKey:"syncSince") ?? ISO8601DateFormatter().string(from:Date())
        UserDefaults.standard.set(installation,forKey:"installation")
        do {
            try FileManager.default.createDirectory(at:folder,withIntermediateDirectories:true,attributes:[.posixPermissions:0o700])
            let file = folder.appendingPathComponent("events.json")
            if FileManager.default.fileExists(atPath:file.path) { events = try JSONDecoder().decode([QueryEvent].self,from:Data(contentsOf:file)) }
            // 上次被强制退出的请求保留失败记录，避免永远显示处理中。
            for i in events.indices where events[i].status == "pending" { events[i].status = "failed"; events[i].revision = UUID().uuidString }
        } catch { historyWritable = false; message = "本地记录读取失败，原文件未覆盖。请检查 Application Support/Sensebook。" }
        if let data = UserDefaults.standard.data(forKey:"model"), let value = try? JSONDecoder().decode(ModelConfig.self,from:data) { model = value }
        key = Vault.read("model-key")
        if let value = Vault.read("device").data(using:.utf8) { connection = try? JSONDecoder().decode(DeviceConfig.self,from:value) }
        followModel = UserDefaults.standard.object(forKey:"followModel") as? Bool ?? true
        syncRecords = UserDefaults.standard.bool(forKey:"syncRecords")
        includeHistory = UserDefaults.standard.bool(forKey:"includeHistory")
        modelName = UserDefaults.standard.string(forKey:"cloudModelName") ?? "本机模型"
        timer = Timer.scheduledTimer(withTimeInterval:60,repeats:true) { [weak self] _ in Task { @MainActor in await self?.sync() } }
        Task { await sync() }
    }
    func persist() {
        guard historyWritable else { message = "历史文件读取异常，已停止写入，避免覆盖原记录。"; return }
        do {
            let file = folder.appendingPathComponent("events.json")
            try JSONEncoder().encode(events).write(to:file, options:.atomic)
            try FileManager.default.setAttributes([.posixPermissions:0o600],ofItemAtPath:file.path)
        }
        catch { message = "无法保存查询记录，请检查磁盘空间和文件权限。" }
    }
    func saveModel(manual: Bool = true) {
        do {
            _ = try Network.baseURL(model.base)
            guard !model.model.trimmingCharacters(in:.whitespacesAndNewlines).isEmpty else { throw AppFailure(message:"请填写模型名称。") }
            try Vault.write("model-key",key.trimmingCharacters(in:.whitespacesAndNewlines))
            UserDefaults.standard.set(try JSONEncoder().encode(model),forKey:"model")
            if manual { followModel = false; modelName = "本机模型"; UserDefaults.standard.removeObject(forKey:"cloudModelName") }
            saveSyncOptions()
            message = "模型已保存到本机，Key 由系统钥匙串保管。"
        } catch { message = error.localizedDescription }
    }
    func saveSyncOptions() {
        if syncRecords && !UserDefaults.standard.bool(forKey:"syncRecords") {
            since = ISO8601DateFormatter().string(from:Date()); UserDefaults.standard.set(since,forKey:"syncSince")
        }
        UserDefaults.standard.set(followModel,forKey:"followModel")
        UserDefaults.standard.set(syncRecords,forKey:"syncRecords")
        UserDefaults.standard.set(includeHistory,forKey:"includeHistory")
    }
    func connect() async {
        do {
            guard let data = deviceText.data(using:.utf8) else { return }
            let cfg = try JSONDecoder().decode(DeviceConfig.self,from:data)
            let url = try Network.baseURL(cfg.endpoint)
            guard url.path.isEmpty || url.path == "/", cfg.token.hasPrefix("sb_"), cfg.token.count == 67 else { throw AppFailure(message:"请完整粘贴网站生成的设备连接配置。") }
            let me = try JSONDecoder().decode(Identity.self,from:await Network.request(url:url.appendingPathComponent("sync/me"),token:cfg.token))
            guard me.account_id == cfg.account_id, me.device_id == cfg.device_id else { throw AppFailure(message:"设备与账号不匹配。") }
            try Vault.write("device",String(decoding:try JSONEncoder().encode(cfg),as:UTF8.self))
            connection = cfg; deviceText = ""; since = ISO8601DateFormatter().string(from:Date())
            UserDefaults.standard.set(since,forKey:"syncSince"); saveSyncOptions(); await sync()
        } catch { syncMessage = "连接失败：\(error.localizedDescription)" }
    }
    func disconnect() {
        do { try Vault.write("device",""); connection = nil; syncMessage = "已断开，已有本机模型和记录仍可使用。" }
        catch { syncMessage = error.localizedDescription }
    }
    func sync() async {
        guard !syncing, let cfg = connection else { return }
        syncing = true; defer { syncing = false }
        do {
            let base = try Network.baseURL(cfg.endpoint)
            func active() throws { guard connection?.token == cfg.token else { throw CancellationError() } }
            let me = try JSONDecoder().decode(Identity.self,from:await Network.request(url:base.appendingPathComponent("sync/me"),token:cfg.token))
            guard me.account_id == cfg.account_id, me.device_id == cfg.device_id else { throw AppFailure(message:"账号身份不匹配。") }
            try active()
            if followModel {
                let response = try JSONDecoder().decode(ProfileResponse.self,from:await Network.request(url:base.appendingPathComponent("sync/model-config"),token:cfg.token))
                try active()
                if followModel {
                    if let p = response.profile {
                        _ = try Network.baseURL(p.base_url)
                        try Vault.write("model-key",p.api_key)
                        model = ModelConfig(base:p.base_url,model:p.model,thinking:p.thinking); key = p.api_key; modelName = p.name
                        UserDefaults.standard.set(try JSONEncoder().encode(model),forKey:"model")
                        UserDefaults.standard.set(p.name,forKey:"cloudModelName")
                    } else if UserDefaults.standard.string(forKey:"cloudModelName") != nil {
                        try Vault.write("model-key",""); key = ""; modelName = "账号未设置默认模型"; UserDefaults.standard.removeObject(forKey:"cloudModelName")
                    }
                }
            }
            if syncRecords {
                let pending = events.filter { ($0.account_id == nil || $0.account_id == cfg.account_id) && $0.synced_revision != $0.revision && (includeHistory || $0.occurred_at >= since) }
                // 单条发送，限制每次请求体积；确认 revision 后才标记已同步。
                for event in pending {
                    try active(); guard syncRecords else { break }
                    struct Batch: Encodable { var events: [QueryEvent] }
                    let data = try await Network.request(url:base.appendingPathComponent("sync/events"),token:cfg.token,body:JSONEncoder().encode(Batch(events:[event])))
                    try active()
                    let response = try JSONDecoder().decode(SyncResponse.self,from:data)
                    if response.deleted.contains(event.id) { events.removeAll { $0.id == event.id } }
                    else if response.accepted.contains(event.id), let i = events.firstIndex(where:{$0.id == event.id}) { events[i].account_id = cfg.account_id; events[i].synced_revision = event.revision }
                    persist()
                }
                var after = 0
                while syncRecords {
                    try active()
                    let url = URL(string:base.appendingPathComponent("sync/deletions").absoluteString + "?after=\(after)")!
                    let d = try JSONDecoder().decode(Deletions.self,from:await Network.request(url:url,token:cfg.token))
                    try active()
                    let ids = Set(d.deleted.map(\.id)); events.removeAll { ids.contains($0.id) }; persist()
                    guard d.has_more, let last = d.deleted.last, last.seq > after else { break }; after = last.seq
                }
            }
            syncMessage = "已连接 · \(syncRecords ? "模型与查询同步已完成":"查询记录不上传") · \(Date().formatted(date:.omitted,time:.shortened))"
        } catch is CancellationError { }
        catch { syncMessage = "同步待重试：\(error.localizedDescription)" }
    }
    func translate() {
        guard !busy else { return }
        let selected = text.trimmingCharacters(in:.whitespacesAndNewlines)
        guard !selected.isEmpty else { message = "先输入或选中一段文字。"; return }
        guard selected.count <= 12000, context.count <= 12000 else { message = "请将选区和原句分别缩短到 12,000 字以内。"; return }
        guard !key.isEmpty else { tab = "settings"; message = "先设置模型 Key，或连接账号获取默认模型。"; return }
        let query = QueryEvent(installation_id:installation,selected_text:selected,context:context,source_app:source,mode:mode)
        events.insert(query,at:0); persist()
        busy = true; result = ""; message = ""; generation = UUID()
        let gen = generation, config = model, secret = key
        task = Task {
            do {
                let value = try await Network.explain(text:query.selected_text,context:query.context,mode:query.mode,config:config,key:secret)
                if let i = events.firstIndex(where:{$0.id == query.id}) { events[i].explanation = value; events[i].status = "ready"; events[i].revision = UUID().uuidString }
                if gen == generation { result = value }
            } catch {
                if let i = events.firstIndex(where:{$0.id == query.id}) { events[i].status = "failed"; events[i].revision = UUID().uuidString }
                if gen == generation { message = Task.isCancelled ? "已取消，可修改后重新查询。" : error.localizedDescription }
            }
            persist(); if gen == generation { busy = false }; await sync()
        }
    }
    func receive(_ value: String, context surrounding: String = "", source app: String) {
        task?.cancel(); generation = UUID(); busy = false
        text = String(value.prefix(12000)); context = String(surrounding.prefix(12000)); source = app; result = ""; message = ""; tab = "translate"
    }
    func openEvent(_ e: QueryEvent) { receive(e.selected_text,context:e.context,source:e.source_app); result = e.explanation }
    func paste() { if let value = NSPasteboard.general.string(forType:.string) { receive(value,source:"剪贴板") } else { message = "剪贴板里没有文字。" } }
    func copyResult() { NSPasteboard.general.clearContents(); NSPasteboard.general.setString(result,forType:.string) }
    func openWebsite() {
        guard let cfg = connection, let url = try? Network.baseURL(cfg.endpoint) else { tab = "settings"; message = "连接个人网站后即可打开回顾。"; return }
        NSWorkspace.shared.open(url)
    }
}
