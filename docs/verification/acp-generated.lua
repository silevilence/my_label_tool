local images = annotool.images({})
local total = 0
for _, image in ipairs(images) do
  local annotations = annotool.annotations({imagePath = image.path})
  total = total + #annotations
end
annotool.log({message = tostring(total)})
