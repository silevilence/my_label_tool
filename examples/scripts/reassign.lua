-- 将“车辆”改派到“汽车”：名称必须唯一，ID 由标签查询返回。
local target = annotool.label({name = "汽车"})
local source = annotool.label({name = "车辆"})
for _, image in ipairs(annotool.images()) do
  local shapes = annotool.annotations({imagePath = image.path})
  for _, shape in ipairs(shapes) do
    if shape.labelId == source.id then shape.labelId = target.id end
  end
  annotool.submit({imagePath = image.path, annotations = shapes})
end
