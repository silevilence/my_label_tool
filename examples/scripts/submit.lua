-- submit：给已有标注添加 reviewed=true 属性，提交每张图片的完整标注数组。
-- 所有图片处理成功后统一应用，可整轮撤销；未提交的图片保持原样。
for _, image in ipairs(annotool.images()) do
  local shapes = annotool.annotations {imagePath = image.path}
  for _, shape in ipairs(shapes) do
    shape.attributes = shape.attributes or {}
    shape.attributes.reviewed = true
  end
  annotool.submit {imagePath = image.path, annotations = shapes}
end
