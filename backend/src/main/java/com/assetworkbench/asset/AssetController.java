package com.assetworkbench.asset;

import com.assetworkbench.asset.AssetService.UploadedAsset;
import com.assetworkbench.identity.DemoSessionController;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
class AssetController {
    private final AssetService assets;

    AssetController(AssetService assets) {
        this.assets = assets;
    }

    @PostMapping(value = "/api/assets", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    ResponseEntity<UploadedAsset> upload(@RequestParam String templateId,
                                        @RequestParam MultipartFile file, HttpServletRequest request) {
        String ownerId = DemoSessionController.requireUserId(request);
        return ResponseEntity.status(HttpStatus.CREATED).cacheControl(CacheControl.noStore())
                .body(assets.upload(ownerId, templateId, file));
    }
}
