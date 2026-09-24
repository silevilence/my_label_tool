-- size：读取原图宽高（像素）。本示例已自动开启“带入图片尺寸”。
-- 复制到自己的脚本后，运行时也需要开启该选项。
for _, image in ipairs(annotool.images()) do
  local size = annotool.size {imagePath = image.path}
  annotool.log {message = string.format("%s：%d × %d 像素", image.name, size.width, size.height)}
end
