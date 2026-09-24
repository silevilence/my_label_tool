-- annotations：读取原始快照中的标注数组，不提交就不会修改项目。
for _, image in ipairs(annotool.images()) do
  local shapes = annotool.annotations {imagePath = image.path}
  annotool.log {message = string.format("%s：%d 个标注", image.name, #shapes)}
  for _, shape in ipairs(shapes) do
    annotool.log {message = string.format("  %s / %s：%s", shape.type, shape.labelId, table.concat(shape.points, ", "))}
  end
end
