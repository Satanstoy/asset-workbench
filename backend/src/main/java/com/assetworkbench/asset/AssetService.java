package com.assetworkbench.asset;

import com.assetworkbench.asset.AssetMapper.Asset;
import com.assetworkbench.template.TemplateMapper;
import com.assetworkbench.template.TemplateMapper.Template;
import com.assetworkbench.web.ApiException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;
import org.springframework.web.multipart.MultipartFile;

import javax.imageio.ImageIO;
import javax.imageio.stream.MemoryCacheImageInputStream;
import java.io.IOException;
import java.nio.file.FileAlreadyExistsException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Locale;
import java.util.UUID;

@Service
class AssetService {
    private static final Logger logger = LoggerFactory.getLogger(AssetService.class);
    private final AssetMapper assets;
    private final TemplateMapper templates;
    private final Path directory;

    AssetService(AssetMapper assets, TemplateMapper templates, @Value("${workbench.assets-directory}") Path directory) {
        this.assets = assets;
        this.templates = templates;
        this.directory = directory.toAbsolutePath().normalize();
    }

    @Transactional
    public UploadedAsset upload(String ownerId, String templateId, MultipartFile file) {
        Template template = templates.find(templateId);
        if (template == null) {
            throw new ApiException(HttpStatus.NOT_FOUND, "TEMPLATE_NOT_FOUND", "找不到制作模板");
        }
        Asset asset = inspect(file, template);
        String id = UUID.randomUUID().toString();
        String storageName = id + ("image/png".equals(asset.mimeType()) ? ".png" : ".jpg");
        Path destination = directory.resolve(storageName);
        try (var source = file.getInputStream()) {
            Files.createDirectories(directory);
            Files.copy(source, destination);
        } catch (FileAlreadyExistsException existingAsset) {
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "ASSET_STORAGE_ERROR", "暂时无法保存素材");
        } catch (IOException writeFailure) {
            removeFile(destination);
            throw new ApiException(HttpStatus.INTERNAL_SERVER_ERROR, "ASSET_STORAGE_ERROR", "暂时无法保存素材");
        }

        TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
            @Override
            public void afterCompletion(int status) {
                if (status == STATUS_ROLLED_BACK) {
                    removeFile(destination);
                }
            }
        });
        assets.insert(id, ownerId, asset, storageName);
        return new UploadedAsset(id, asset.mimeType(), asset.sizeBytes());
    }

    private Asset inspect(MultipartFile file, Template template) {
        if (file.getSize() > template.maxFileSizeBytes()) {
            throw new ApiException(HttpStatus.PAYLOAD_TOO_LARGE, "IMAGE_TOO_LARGE", "图片超过文件大小限制");
        }
        try (var source = file.getInputStream(); var input = new MemoryCacheImageInputStream(source)) {
            var readers = ImageIO.getImageReaders(input);
            if (!readers.hasNext()) {
                throw invalidContent();
            }
            var reader = readers.next();
            try {
                reader.setInput(input, true, true);
                String mime = switch (reader.getFormatName().toLowerCase(Locale.ROOT)) {
                    case "jpeg" -> "image/jpeg";
                    case "png" -> "image/png";
                    default -> "";
                };
                String declared = file.getContentType();
                if (!template.acceptedMimeTypes().contains(mime)
                        || (declared != null && !"application/octet-stream".equals(declared) && !mime.equals(declared))) {
                    throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_IMAGE_TYPE", "请选择符合模板格式要求的图片");
                }
                int width = reader.getWidth(0);
                int height = reader.getHeight(0);
                if ((long) width * height > template.maxImagePixels()) {
                    throw new ApiException(HttpStatus.BAD_REQUEST, "IMAGE_PIXELS_EXCEEDED", "图片超过像素限制");
                }
                reader.read(0);
                return new Asset(mime, file.getSize(), width, height);
            } finally {
                reader.dispose();
            }
        } catch (IOException | IllegalArgumentException invalidImage) {
            throw invalidContent();
        }
    }

    private ApiException invalidContent() {
        return new ApiException(HttpStatus.BAD_REQUEST, "INVALID_IMAGE_CONTENT", "图片内容无法读取");
    }

    private void removeFile(Path path) {
        try {
            Files.deleteIfExists(path);
        } catch (IOException exception) {
            logger.warn("无法清理未提交的素材 {}", path.getFileName(), exception);
        }
    }

    record UploadedAsset(String id, String mimeType, long sizeBytes) {
    }
}
