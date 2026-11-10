package com.assetworkbench.template;

import com.assetworkbench.template.TemplateMapper.Template;
import com.assetworkbench.web.ApiException;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

@RestController
@RequestMapping("/api/templates")
class TemplateController {
    private final TemplateMapper templates;

    TemplateController(TemplateMapper templates) {
        this.templates = templates;
    }

    @GetMapping
    TemplateList list(@RequestParam(required = false) String category) {
        return new TemplateList(templates.categories(), templates.list(category).stream().map(TemplateView::from).toList());
    }

    @GetMapping("/{id}")
    TemplateView detail(@PathVariable String id) {
        Template template = templates.find(id);
        if (template == null) {
            throw new ApiException(HttpStatus.NOT_FOUND, "TEMPLATE_NOT_FOUND", "找不到制作模板");
        }
        return TemplateView.from(template);
    }

    record TemplateList(List<String> categories, List<TemplateView> templates) {
    }

    record TemplateView(String id, String title, String category, String coverUrl, String description,
                        int requiredImageCount, List<String> acceptedMimeTypes, long maxFileSizeBytes,
                        long maxImagePixels) {
        static TemplateView from(Template template) {
            return new TemplateView(template.id(), template.title(), template.category(),
                    "/api/demo-images/" + template.coverImage(), template.description(),
                    template.requiredImageCount(), template.acceptedMimeTypes(),
                    template.maxFileSizeBytes(), template.maxImagePixels());
        }
    }
}
