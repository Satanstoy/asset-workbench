INSERT INTO templates (id, title, category, cover_image, description, required_image_count, result_image)
VALUES
    ('postcard', '旅行明信片', '创意图片', 'postcard-cover.png', '上传一张旅行照片，体验生成明信片的流程。', 1, 'postcard-result.png'),
    ('collage', '双图拼贴', '拼贴设计', 'collage-cover.png', '上传两张图片，体验生成双图拼贴的流程。', 2, 'collage-result.png')
AS seed
ON DUPLICATE KEY UPDATE title = seed.title, category = seed.category, cover_image = seed.cover_image,
    description = seed.description, required_image_count = seed.required_image_count, result_image = seed.result_image;
