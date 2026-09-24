-- 将所有坐标移动到非负区间；坐标为原图像素。
for _, image in ipairs(annotool.images()) do
  local shapes = annotool.annotations({imagePath = image.path})
  for _, shape in ipairs(shapes) do
    for i, value in ipairs(shape.points) do shape.points[i] = math.max(0, value) end
  end
  annotool.submit({imagePath = image.path, annotations = shapes})
end
