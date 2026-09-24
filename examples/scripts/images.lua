-- images：按当前作用域顺序枚举图片，只读取，不修改标注。
local images = annotool.images()
for index, image in ipairs(images) do
  annotool.log {message = string.format("%d. %s (%s)", index, image.name, image.path)}
end
