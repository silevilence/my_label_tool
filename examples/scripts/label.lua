-- label：通过已有标注取得标签 ID，再按 ID / 名称查询标签。
-- 名称查询要求标签名唯一；本示例不修改标注。
for _, image in ipairs(annotool.images()) do
  local shapes = annotool.annotations {imagePath = image.path}
  if #shapes > 0 then
    local label = annotool.label {id = shapes[1].labelId}
    local same = annotool.label {name = label.name}
    annotool.log {message = string.format("标签：%s，ID：%s", same.name, same.id)}
    return
  end
end
annotool.log {message = "当前作用域没有标注，请先添加一个标注再运行。"}
