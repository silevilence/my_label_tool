-- log：向脚本面板输出文本；数字或其他值请先格式化为字符串。
annotool.log {message = "开始检查当前作用域。"}
annotool.log {message = string.format("共有 %d 张图片。", #annotool.images())}
annotool.log {message = "检查完成，标注未修改。"}
