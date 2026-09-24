-- 一次运行的计数跨图片连续，传输分块不改变编号。
local number = 0
local images = annotool.images()
for index, image in ipairs(images) do
  local shapes = annotool.annotations({imagePath = image.path})
  for _, shape in ipairs(shapes) do
    number = number + 1
    shape.attributes = shape.attributes or {}
    shape.attributes.sequence = number
  end
  annotool.submit({imagePath = image.path, annotations = shapes})
  annotool.progress({completed = index, total = #images})
end
