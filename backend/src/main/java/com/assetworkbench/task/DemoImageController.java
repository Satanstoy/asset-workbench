package com.assetworkbench.task;

import com.assetworkbench.web.ApiException;
import org.springframework.core.io.ClassPathResource;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

@RestController
class DemoImageController {
    @GetMapping("/api/demo-images/{filename}")
    ResponseEntity<Resource> preview(@PathVariable String filename) {
        Resource image = resource(filename);
        if (image == null) {
            throw new ApiException(HttpStatus.NOT_FOUND, "IMAGE_NOT_FOUND", "找不到演示图片");
        }
        return ResponseEntity.ok().contentType(MediaType.IMAGE_PNG).body(image);
    }

    static Resource resource(String filename) {
        if (!filename.matches("[a-zA-Z0-9_-]+\\.png")) {
            return null;
        }
        Resource image = new ClassPathResource("demo-images/" + filename);
        return image.isReadable() ? image : null;
    }
}
