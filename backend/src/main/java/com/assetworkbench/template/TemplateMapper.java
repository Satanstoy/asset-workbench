package com.assetworkbench.template;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Select;

import java.util.List;

@Mapper
public interface TemplateMapper {
    String COLUMNS = """
            SELECT id, title, category, cover_image, description, required_image_count,
                   accepted_mime_types, max_file_size_bytes, max_image_pixels FROM templates
            """;

    @Select(COLUMNS + " WHERE id = #{id}")
    Template find(String id);

    @Select("<script>" + COLUMNS + """
            <if test="category != null"> WHERE category = #{category}</if>
            ORDER BY id
            </script>
            """)
    List<Template> list(String category);

    @Select("SELECT DISTINCT category FROM templates ORDER BY category")
    List<String> categories();

    record Template(String id, String title, String category, String coverImage, String description,
                    int requiredImageCount, String mimeTypes, long maxFileSizeBytes, long maxImagePixels) {
        public List<String> acceptedMimeTypes() {
            return List.of(mimeTypes.split(","));
        }
    }
}
