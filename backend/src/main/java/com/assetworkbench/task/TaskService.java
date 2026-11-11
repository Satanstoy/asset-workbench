package com.assetworkbench.task;

import com.assetworkbench.asset.AssetMapper;
import com.assetworkbench.asset.AssetMapper.Asset;
import com.assetworkbench.task.TaskController.Simulation;
import com.assetworkbench.task.TaskController.Submission;
import com.assetworkbench.task.TaskMapper.TaskResponse;
import com.assetworkbench.task.TaskMapper.TaskRow;
import com.assetworkbench.task.TaskWorkflow.Stage;
import com.assetworkbench.template.TemplateMapper;
import com.assetworkbench.template.TemplateMapper.Template;
import com.assetworkbench.web.ApiException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
class TaskService {
    private final TaskMapper mapper;
    private final TemplateMapper templates;
    private final AssetMapper assets;
    private final boolean simulationEnabled;

    TaskService(TaskMapper mapper, TemplateMapper templates, AssetMapper assets,
                @Value("${workbench.simulation-enabled}") boolean simulationEnabled) {
        this.mapper = mapper;
        this.templates = templates;
        this.assets = assets;
        this.simulationEnabled = simulationEnabled;
    }

    @Transactional
    public TaskResponse submit(String ownerId, Submission submission) {
        if (submission.templateId() == null || submission.templateId().isBlank()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "TEMPLATE_REQUIRED", "请选择制作模板");
        }
        Template template = templates.find(submission.templateId());
        if (template == null) {
            throw new ApiException(HttpStatus.NOT_FOUND, "TEMPLATE_NOT_FOUND", "找不到制作模板");
        }
        if (submission.assetIds() == null || submission.assetIds().size() != template.requiredImageCount()) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_INPUT_COUNT", "素材数量不符合模板要求");
        }
        var acceptedTypes = template.acceptedMimeTypes();
        for (String id : submission.assetIds()) {
            Asset asset = assets.findOwned(id, ownerId);
            if (asset == null || !acceptedTypes.contains(asset.mimeType())
                    || asset.sizeBytes() > template.maxFileSizeBytes()
                    || (long) asset.width() * asset.height() > template.maxImagePixels()) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_ASSET", "所选素材无法用于制作");
            }
        }

        int delay = 2000;
        Stage failAt = null;
        Simulation simulation = submission.simulation();
        if (simulation != null) {
            if (!simulationEnabled) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "SIMULATION_DISABLED", "模拟控制未启用");
            }
            if (simulation.stageDelayMs() != null) {
                delay = simulation.stageDelayMs();
            }
            if (delay < 0 || delay > 10_000) {
                throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_STAGE_DELAY", "阶段耗时须在 0 到 10000 毫秒之间");
            }
            failAt = simulation.failAtStage();
        }

        mapper.insertTask(ownerId, submission.templateId(), delay, failAt);
        long taskId = mapper.lastTaskId();
        for (int slot = 0; slot < submission.assetIds().size(); slot++) {
            mapper.insertInput(taskId, slot, submission.assetIds().get(slot));
        }
        return mapper.ownedTask(taskId, ownerId).response();
    }

    TaskResponse find(String ownerId, long taskId) {
        TaskRow task = mapper.ownedTask(taskId, ownerId);
        if (task == null) {
            throw TaskController.notFound();
        }
        return task.response();
    }

    @Transactional
    public void delete(String ownerId, long id) {
        TaskResponse task = find(ownerId, id);
        if (!"SUCCEEDED".equals(task.status()) && !"FAILED".equals(task.status())) {
            throw new ApiException(HttpStatus.CONFLICT, "TASK_ACTIVE", "等待或处理中的任务不能删除");
        }
        mapper.markDeleted(id);
    }

    List<TaskResponse> history(String ownerId, String templateId, boolean activeOnly) {
        return mapper.history(ownerId, templateId, activeOnly).stream().map(TaskRow::response).toList();
    }
}
