-- progress：按图片更新处理进度；total 必须大于 0，completed 不能超过 total。
local images = annotool.images()
if #images == 0 then return end
annotool.progress {completed = 0, total = #images}
for index, image in ipairs(images) do
  local shapes = annotool.annotations {imagePath = image.path}
  annotool.log {message = string.format("已读取 %s 的 %d 个标注", image.name, #shapes)}
  annotool.progress {completed = index, total = #images}
end
