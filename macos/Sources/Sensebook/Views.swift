import SwiftUI
import AppKit

let ink = Color(red:0.16,green:0.27,blue:0.22)
let leaf = Color(red:0.27,green:0.43,blue:0.32)
let paper = Color(red:0.97,green:0.97,blue:0.94)

struct RootView: View {
    @ObservedObject var store: Store
    var capture: () -> Void
    var permission: () -> Void
    var body: some View {
        VStack(spacing:0) {
            HStack(spacing:10) {
                Image(systemName:"leaf.fill").foregroundStyle(leaf).font(.title2)
                VStack(alignment:.leading,spacing:2) { Text("Sensebook").font(.system(size:19,weight:.semibold,design:.rounded)); Text("理解，发生在语境里").font(.system(size:11)).foregroundStyle(.secondary) }
                Spacer()
                Button { store.pinned.toggle() } label: { Image(systemName:store.pinned ? "pin.fill":"pin") }.help("固定窗口，切换应用时不隐藏").buttonStyle(.borderless)
                Button { NSApp.keyWindow?.orderOut(nil) } label: { Image(systemName:"xmark") }.buttonStyle(.borderless).help("隐藏 · Esc")
            }.padding(.horizontal,22).padding(.top,14).padding(.bottom,18)
            HStack(spacing:6) {
                nav("translate","语境翻译","text.bubble")
                nav("history","查询足迹","clock")
                nav("settings","设置","slider.horizontal.3")
                Spacer()
                Button { store.openWebsite() } label: { Image(systemName:"arrow.up.right.square"); Text("回顾") }.buttonStyle(.borderless)
            }.padding(.horizontal,20).padding(.bottom,12)
            Divider().opacity(0.5)
            ScrollView {
                VStack(alignment:.leading,spacing:18) {
                    if store.tab == "translate" { translation }
                    else if store.tab == "history" { history }
                    else { settings }
                    if !store.message.isEmpty { Label(store.message,systemImage:"info.circle").font(.callout).foregroundStyle(leaf).textSelection(.enabled).padding(12).frame(maxWidth:.infinity,alignment:.leading).background(leaf.opacity(0.07),in:RoundedRectangle(cornerRadius:10)) }
                }.padding(22)
            }
            Divider().opacity(0.5)
            HStack { Circle().fill(store.key.isEmpty ? Color.orange:leaf).frame(width:6,height:6); Text(store.key.isEmpty ? "设置模型后开始阅读":"\(store.modelName) · \(store.model.model)").lineLimit(1); Spacer(); Text("⌘⇧D 划词 · ⌘⇧Space 输入") }.font(.system(size:10)).foregroundStyle(.secondary).padding(.horizontal,20).padding(.vertical,12)
        }.foregroundStyle(ink).background(paper).frame(minWidth:490,minHeight:560)
            .onExitCommand { NSApp.keyWindow?.orderOut(nil) }
    }
    func nav(_ id: String,_ title: String,_ icon: String) -> some View {
        Button { store.tab = id; store.message = "" } label: { Label(title,systemImage:icon).font(.system(size:12,weight:.medium)).padding(.horizontal,12).padding(.vertical,8).background(store.tab == id ? leaf.opacity(0.12):Color.clear,in:RoundedRectangle(cornerRadius:8)) }.buttonStyle(.plain)
    }
    func heading(_ title: String,_ subtitle: String) -> some View {
        VStack(alignment:.leading,spacing:5) { Text(title).font(.system(size:22,weight:.medium,design:.rounded)); Text(subtitle).font(.system(size:12)).foregroundStyle(.secondary) }
    }
    func editor(_ label: String,_ value: Binding<String>, height: CGFloat) -> some View {
        VStack(alignment:.leading,spacing:8) { Text(label).font(.system(size:11,weight:.medium)).foregroundStyle(.secondary)
            TextEditor(text:value).font(.system(size:15)).scrollContentBackground(.hidden).padding(8).frame(height:height).background(Color.white.opacity(0.8),in:RoundedRectangle(cornerRadius:10)).overlay(RoundedRectangle(cornerRadius:10).stroke(leaf.opacity(0.12)))
        }
    }
    var translation: some View {
        VStack(alignment:.leading,spacing:16) {
            heading("读懂这一刻。","选一个表达，也带上它所在的句子。")
            HStack { Picker("方式",selection:$store.mode) { Text("语境解释").tag("sense"); Text("整句翻译").tag("translate") }.pickerStyle(.segmented).frame(width:220); Spacer(); Button("粘贴") { store.paste() }; Button { capture() } label: { Image(systemName:"viewfinder") }.help("截图识别，文字可编辑后再提交") }
            editor("所选内容",$store.text,height:88)
            editor("原句 / 上下文 · 可补充",$store.context,height:62)
            HStack { Label(store.source,systemImage:"doc.text").font(.caption).foregroundStyle(.secondary).lineLimit(1); Spacer()
                if store.busy { ProgressView().controlSize(.small); Button("取消") { store.task?.cancel() } }
                else { Button { store.translate() } label: { Label("理解这段文字",systemImage:"sparkles").padding(.horizontal,8).padding(.vertical,4) }.buttonStyle(.borderedProminent).tint(leaf).keyboardShortcut(.return,modifiers:.command) }
            }
            if !store.result.isEmpty {
                VStack(alignment:.leading,spacing:12) { HStack { Label("\(store.mode == "sense" ? "语境笔记":"译文")",systemImage:"quote.bubble").font(.system(size:12,weight:.semibold)); Spacer(); Button("复制") { store.copyResult() }.buttonStyle(.borderless) }; Text(store.result).font(.system(size:15)).lineSpacing(7).textSelection(.enabled).frame(maxWidth:.infinity,alignment:.leading) }.padding(18).background(Color.white.opacity(0.85),in:RoundedRectangle(cornerRadius:14))
            } else if !store.busy { Text("无需登录即可翻译。查询自动留在本机，是否同步由你决定。").font(.caption).foregroundStyle(.secondary) }
        }
    }
    var history: some View {
        VStack(alignment:.leading,spacing:14) {
            heading("阅读留下的线索。","\(store.events.count) 次查询，每一次都有自己的语境。")
            TextField("搜索表达、原句或解释",text:$store.search).textFieldStyle(.roundedBorder)
            let filtered = store.events.filter { store.search.isEmpty || ($0.selected_text + $0.context + $0.explanation).localizedCaseInsensitiveContains(store.search) }
            if filtered.isEmpty { Label("还没有记录，试着查询一段文字。",systemImage:"text.book.closed").foregroundStyle(.secondary).padding(.vertical,30) }
            ForEach(filtered.prefix(100)) { e in
                Button { store.openEvent(e) } label: { VStack(alignment:.leading,spacing:8) { HStack { Text(e.selected_text).font(.system(size:16,weight:.medium)).lineLimit(2); Spacer(); Image(systemName:"arrow.up.right").font(.caption) }; if !e.context.isEmpty { Text(e.context).font(.caption).foregroundStyle(.secondary).lineLimit(2) }; Text(e.explanation.isEmpty ? (e.status == "pending" ? "正在解释…":"未完成 · 点击重新查询"):e.explanation).font(.system(size:12)).lineLimit(3); Text("\(e.occurred_at.replacingOccurrences(of:"T",with:" ").prefix(16)) · \(e.source_app)").font(.system(size:10)).foregroundStyle(.secondary) }.frame(maxWidth:.infinity,alignment:.leading).padding(15).background(Color.white.opacity(0.8),in:RoundedRectangle(cornerRadius:12)) }.buttonStyle(.plain)
            }
            if filtered.count > 100 { Text("显示最近 100 条匹配记录，其他记录仍保存在本机。搜索可查找更早记录。").font(.caption).foregroundStyle(.secondary) }
        }
    }
    var settings: some View {
        VStack(alignment:.leading,spacing:16) {
            heading("按你的方式阅读。","自己的模型，自己的阅读记录。")
            GroupBox("模型 · OpenAI 兼容接口") {
                VStack(alignment:.leading,spacing:10) {
                    TextField("Base URL",text:$store.model.base).textFieldStyle(.roundedBorder)
                    TextField("模型名称",text:$store.model.model).textFieldStyle(.roundedBorder)
                    SecureField("API Key · 保存在系统钥匙串",text:$store.key).textFieldStyle(.roundedBorder)
                    Toggle("DeepSeek 思考模式",isOn:$store.model.thinking)
                    Button("保存本机模型") { store.saveModel() }
                    Text("手动保存会暂停跟随账号模型。Key 不写入查询记录。").font(.caption).foregroundStyle(.secondary)
                }.padding(8)
            }
            GroupBox("账号与同步 · 可选") {
                VStack(alignment:.leading,spacing:10) {
                    Text(store.syncMessage).font(.caption).textSelection(.enabled)
                    if store.connection == nil { SecureField("粘贴网站生成的设备连接配置",text:$store.deviceText).textFieldStyle(.roundedBorder); Button("连接账号") { Task { await store.connect() } }.disabled(store.deviceText.isEmpty || store.syncing) }
                    Toggle("自动使用账号默认模型",isOn:$store.followModel).onChange(of:store.followModel) { _ in store.saveSyncOptions() }
                    Toggle("同步查询记录到个人网站",isOn:$store.syncRecords).onChange(of:store.syncRecords) { _ in store.saveSyncOptions() }
                    if store.syncRecords { Toggle("包含已有查询",isOn:$store.includeHistory).onChange(of:store.includeHistory) { _ in store.saveSyncOptions() } }
                    if store.connection != nil { HStack { Button(store.syncing ? "同步中…":"立即同步") { Task { await store.sync() } }.disabled(store.syncing); Button("断开连接") { store.disconnect() } } }
                }.padding(8)
            }
            GroupBox("在任何应用中使用") {
                VStack(alignment:.leading,spacing:9) {
                    Text("⌘⇧D  获取当前选区\n⌘⇧Space  打开输入窗口\n⌘Return  提交查询 · Esc  隐藏窗口").font(.callout).lineSpacing(5)
                    Button("允许读取所选文字…") { permission() }
                    Text("划词需要辅助功能权限。不支持读取的应用可先复制，再点击粘贴；不会自动读取剪贴板。截图使用系统屏幕录制权限，OCR 在本机完成。").font(.caption).foregroundStyle(.secondary)
                }.frame(maxWidth:.infinity,alignment:.leading).padding(8)
            }
            Text("Sensebook 0.3.0-preview.1 · 原生体验版").font(.caption).foregroundStyle(.secondary)
        }
    }
}
