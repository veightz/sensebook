import AppKit
let destination = CommandLine.arguments[1]
// 原创图标：纸张上的阅读叶片，纯矢量绘制。
let image = NSImage(size:NSSize(width:1024,height:1024))
image.lockFocus()
NSColor(calibratedRed:0.19,green:0.34,blue:0.26,alpha:1).setFill()
NSBezierPath(roundedRect:NSRect(x:40,y:40,width:944,height:944),xRadius:220,yRadius:220).fill()
NSColor(calibratedRed:0.96,green:0.96,blue:0.88,alpha:1).setFill()
let book = NSBezierPath(roundedRect:NSRect(x:240,y:226,width:544,height:572),xRadius:50,yRadius:50); book.fill()
NSColor(calibratedRed:0.40,green:0.55,blue:0.39,alpha:1).setFill()
let leaf = NSBezierPath(); leaf.move(to:NSPoint(x:405,y:409)); leaf.curve(to:NSPoint(x:688,y:681),controlPoint1:NSPoint(x:331,y:640),controlPoint2:NSPoint(x:569,y:716)); leaf.curve(to:NSPoint(x:405,y:409),controlPoint1:NSPoint(x:711,y:479),controlPoint2:NSPoint(x:550,y:360)); leaf.fill()
NSColor(calibratedRed:0.19,green:0.34,blue:0.26,alpha:1).setStroke()
let vein = NSBezierPath(); vein.lineWidth=18; vein.lineCapStyle = .round; vein.move(to:NSPoint(x:367,y:336)); vein.line(to:NSPoint(x:618,y:615)); vein.stroke()
image.unlockFocus()
let rep = NSBitmapImageRep(data:image.tiffRepresentation!)!
try rep.representation(using:.png,properties:[:])!.write(to:URL(fileURLWithPath:destination))
