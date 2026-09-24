-- 一次运行的计数跨图片连续，传输分块不改变编号。
local number = 0
local images = annotool.call("images")
for index, image in ipairs(images) do
  local shapes = annotool.call("annotations", {imagePath = image.path})
  for _, shape in ipairs(shapes) do
    number = number + 1
    shape.attributes = shape.attributes or {}
    shape.attributes.sequence = number
  end
  annotool.call("submit", {imagePath = image.path, annotations = shapes})
  annotool.call("progress", {completed = index, total = #images})
end
