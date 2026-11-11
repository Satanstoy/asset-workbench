package com.assetworkbench.task;

import com.assetworkbench.task.TaskWorkflow.StageFailure;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.imageio.ImageIO;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.image.BufferedImage;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.List;

@Component
class CollageResults {
    private static final int PANEL_SIZE = 560;
    private static final int MARGIN = 20;
    private final Path directory;

    CollageResults(@Value("${workbench.assets-directory}") Path assetsDirectory) {
        this.directory = assetsDirectory.toAbsolutePath().normalize().resolve("results");
    }

    static String url(long taskId) {
        return "/api/tasks/" + taskId + "/result";
    }

    Path file(long taskId) {
        return directory.resolve(taskId + ".png");
    }

    BufferedImage compose(List<Path> inputs) {
        if (inputs.size() != 2) {
            throw new StageFailure("ASSET_UNREADABLE", "双图拼贴需要两张可读素材");
        }
        var canvas = new BufferedImage(2 * PANEL_SIZE + 3 * MARGIN, PANEL_SIZE + 2 * MARGIN,
                BufferedImage.TYPE_INT_RGB);
        Graphics2D graphics = canvas.createGraphics();
        try {
            graphics.setColor(new Color(0xf5f1e8));
            graphics.fillRect(0, 0, canvas.getWidth(), canvas.getHeight());
            graphics.setRenderingHint(RenderingHints.KEY_INTERPOLATION, RenderingHints.VALUE_INTERPOLATION_BICUBIC);
            draw(graphics, inputs.get(0), MARGIN);
            draw(graphics, inputs.get(1), PANEL_SIZE + 2 * MARGIN);
            return canvas;
        } catch (IOException unreadable) {
            throw new StageFailure("ASSET_UNREADABLE", "无法读取拼贴素材");
        } finally {
            graphics.dispose();
        }
    }

    private void draw(Graphics2D graphics, Path file, int left) throws IOException {
        BufferedImage image = ImageIO.read(file.toFile());
        if (image == null) {
            throw new IOException("Unsupported image");
        }
        try {
            double scale = Math.min((double) PANEL_SIZE / image.getWidth(), (double) PANEL_SIZE / image.getHeight());
            int width = Math.max(1, (int) Math.round(image.getWidth() * scale));
            int height = Math.max(1, (int) Math.round(image.getHeight() * scale));
            graphics.drawImage(image, left + (PANEL_SIZE - width) / 2, MARGIN + (PANEL_SIZE - height) / 2,
                    width, height, null);
        } finally {
            image.flush();
        }
    }

    String publish(long taskId, BufferedImage canvas) {
        try {
            Files.createDirectories(directory);
            Path temporary = Files.createTempFile(directory, "collage-", ".tmp");
            try {
                if (!ImageIO.write(canvas, "png", temporary.toFile())) {
                    throw new IOException("PNG encoder unavailable");
                }
                Files.move(temporary, file(taskId), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            } finally {
                Files.deleteIfExists(temporary);
            }
            return url(taskId);
        } catch (IOException unavailable) {
            throw new StageFailure("RESULT_UNAVAILABLE", "无法保存拼贴结果");
        }
    }
}
