-- 将“车辆”改派到“汽车”：名称必须唯一，ID 由标签查询返回。
local target = annotool.call("label", {name = "汽车"})
local source = annotool.call("label", {name = "车辆"})
for _, image in ipairs(annotool.call("images")) do
  local shapes = annotool.call("annotations", {imagePath = image.path})
  for _, shape in ipairs(shapes) do
    if shape.labelId == source.id then shape.labelId = target.id end
  end
  annotool.call("submit", {imagePath = image.path, annotations = shapes})
end
