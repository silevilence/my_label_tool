# 视频标注

从左侧菜单「打开项目文件夹」开始，同一目录可包含图片和多个视频。
左侧「项目素材」按图片/视频显示：点击图片直接标注；点击尚未准备的视频，
在弹窗中设置抽帧间隔（源视频每 N 帧取一帧，默认 30），确认后准备帧。
也可从菜单「添加视频到项目」选择外部视频；没有打开项目时先选择项目目录。
添加视频保留当前图片、其它视频、标注、标签和撤销历史。
程序在项目目录下新建独立 `video-*` 帧目录，原视频与已有文件均不覆盖。
失败或取消会清理本次未完成目录，当前项目保持原状。
每次解码最长 30 分钟，最多 100 万源帧、1 万抽取帧；超过时分段导入或增大间隔。

帧图片是原分辨率 PNG，复用图片列表与画布；`my-label-tool.video.json`
保存 schemaVersion 1、原视频路径、抽帧间隔、源总帧数、帧尺寸以及每帧
文件名、源帧序号和实际呈现时间（以首帧为零）。旋转由解码器应用，尺寸
以解码 PNG 为准。再次打开项目目录时，自动识别各个直接子目录中的元数据并校验帧序列；
旧版单视频帧目录仍可直接打开。不跟随目录符号链接。
视频帧禁止通过图片删除入口删除，避免损坏时间轴。

视频在素材列表中作为单独条目，选中后展开其帧；切换视频会记住各自当前帧。
选中视频帧时，时间轴显示在原画布底部；切回图片时隐藏。
拖动滑块跳转到已抽取帧；同时显示当前源帧/总帧数、
实际时间戳和抽取帧总数。界面源帧从 1 开始显示，数据中的 frameIndex 从 0 开始。
列表点选及已有上一张/下一张快捷键同样可以切帧，并同步时间轴。
专用切帧快捷键为 **PageUp（上一帧）/ PageDown（下一帧）**，仅在当前视频的已抽取帧内移动，
到首尾停止，不跳到其它视频或图片。可在「设置 → 快捷键」中录制修改，并自动保存。
图片模式、输入框和弹窗内不触发切帧；旧配置已占用默认键时，新动作保持未绑定，避免抢占原功能。

矩形、多边形和点均复用图片标注操作。手绘、导入和预打标写入 store 时统一关联源帧号，
不会把抽取列表序号当作源帧号。原生 JSON 保存所有图形、属性和 frameIndex；重新打开
项目目录并加载项目配置即可恢复。帧名称携带各自子目录前缀，避免多视频帧名相同造成覆盖。
解码图片缓存最多保留 8 张且不超过 128 MiB 估算像素内存，
当前显示的图片可在缓存外持有，单张超大图片不放入缓存。

## 跨帧插值

展开画布底部「跨帧插值」，选中起始帧标注，选择「新建轨迹」并设为关键帧；切换到
另一帧，选中同一目标的标注，在轨迹列表中选择同一轨迹并再次设为关键帧。
点击「预览插值」查看将生成的帧与坐标，再「应用插值」写入标注。
结果可通过时间轴在画布中查看；撤销/重做复用既有逐帧历史。

矩形、点和顶点数量/顺序相同的多边形按源帧序号比例做分段线性插值；不外推端点外帧。
关键帧必须具有相同标签和图形类型。其它目标不受影响，重复轨迹和同轨迹人工中间标注
会阻止插值；旧自动插值可以重新计算。人工调整插值图形或标签会自动将它提升为关键帧。
预览之后标注发生变化，必须重新预览才可应用。轨迹和插值严格限定在当前视频，
即使不同视频使用相同轨迹 ID，也不会合并处理。

数据使用现有 `AnnotationShape.attributes` 扩展字典：`videoTrackId`（字符串）、
`videoKeyframe`（布尔）、`videoInterpolated`（布尔）。其它属性复制自区间起始关键帧。
这三个宿主保留属性随原生 JSON 保存，未增加插件字段或协议能力；插件处理 attributes
时继续遵守既有字典契约。多边形顶点对应关系需由标注者保证，算法不猜测目标关联。

## 导出及格式选择

所有素材共用侧栏「保存 / 另存为」和 Ctrl+S。含视频时，「项目 JSON（图片与视频）」
在既有 labels/images 外增加可选的 `projectMedia: { schemaVersion: 1, videos: [...] }`，
每项保存 sourcePath、相对 frameFolder、原始 VideoProject 元数据（未抽帧时后两项为 null）。
字段见 [混合项目 Schema](project-media.schema.json)，复用 [视频 Schema](video-annotation.schema.json)。
视频 sourcePath 是定位提示，不嵌入视频字节；交付项目应保留帧子目录及其元数据。
原生解析器继续读取 labels/images，ProjectConfig.schemaVersion 仍为 1。

第一次保存选择 JSON 路径并创建项目配置；后续 Ctrl+S 保存同一 JSON。
选择 COCO/VOC/YOLO 后的「另存为」生成包含图片和全部视频帧的数据集，帧子目录防止重名覆盖。
这些导出不会把混合项目的保存格式改成有损格式，Ctrl+S 继续保存原生 JSON。
旧单视频 JSON 的 labels/images 仍可解析，独立顶部导出入口已并入项目机制。

格式评估（2026-09-18）：

| 格式 | 本项目选择 | 信息保留 |
| --- | --- | --- |
| COCO | 继续导出逐帧 images/annotations/categories | 保留当前支持的图形表示，不承诺时间与轨迹 |
| VOC | 继续每帧一个 XML | 适合矩形检测数据集，不承诺时间与轨迹 |
| YOLO | 继续每帧一个 TXT | 适合矩形检测数据集，沿用归一化转换，不承诺时间与轨迹 |
| 项目 JSON | 原生 labels/images 加可选版本化 projectMedia | 保留图片、多个视频、三种图形、空帧、时间戳、源帧号与轨迹属性 |

依据：[COCO 格式入口](https://cocodataset.org/#format-data)、
[基于 COCO API 的 YouTubeVIS 扩展](https://github.com/youtubevos/cocoapi)、
[VOC 开发包](https://www.robots.ox.ac.uk/~vgg/projects/pascal/VOC/voc2008/htmldoc/index.html)、
[Ultralytics 检测数据格式](https://docs.ultralytics.com/datasets/detect)。
YouTubeVIS 有自己的视频实例分割接口，因此本次选择自定义结构来完整保存本工具的矩形、
点、多边形与编辑元数据，未把宿主扩展字段混入现有 COCO 插件或标准格式承诺。

开发机提供 FFmpeg/FFprobe；安装包将两个静态可执行文件、发行版 LICENSE、
版本和校验记录放入 `video-tools` 资源目录，运行时不下载工具。
打包前自动执行 `scripts/prepare-video-tools.ps1`，工具缺失则构建失败。
Windows 发布工作流准备同样的构建工具。
当前使用 FFmpeg 7.1.1 完整静态发行版，两个程序合计约 283 MiB（安装器压缩前），
因此带视频能力的发行包会明显增大；可执行程序部署时需保留相邻的 `video-tools` 目录。

自动化验证可运行 `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/verify-video-support.ps1`。
脚本检查前端类型、lint、覆盖率、Rust lint/测试、真实 FFmpeg 抽帧及前端构建；
开发机需提供 FFmpeg/FFprobe，测试会生成恒定帧率、变帧率和旋转元数据视频。
另用 `npm run tauri build -- --debug --no-bundle` 检查桌面构建，不启动应用窗口。
完整结果与审核修复见 [验收记录](verification/video-annotation.md)。

实现依据：[FFmpeg select 过滤器](https://ffmpeg.org/ffmpeg-filters.html#select_002c-aselect)、
[FFprobe 逐帧时间戳](https://ffmpeg.org/ffprobe.html)。固定间隔按解码帧号选择，
不由平均帧率推导实际时间，因此支持变帧率的时间定位。

## 插件边界评估

视频导入、取消和元数据加载是宿主专用 Tauri commands，插件无调用入口。
视频元数据使用独立宿主文件，不改变 ProjectConfig 或插件 AnnotationExport
结构。现有 `AnnotationShape.frameIndex` 表示源视频帧序号；坐标仍是原图像素。
插件仍接收经既有权限模型处理的帧图片和既有标注字段。没有新增插件能力、
消息或错误码，无需递增宿主 API、协议或插件版本。
