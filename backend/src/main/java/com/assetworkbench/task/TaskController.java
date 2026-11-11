package com.assetworkbench.task;

import com.assetworkbench.identity.DemoSessionController;
import com.assetworkbench.task.TaskMapper.TaskResponse;
import com.assetworkbench.task.TaskWorkflow.Stage;
import com.assetworkbench.web.ApiException;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.core.io.FileSystemResource;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.nio.file.Files;
import java.util.List;

@RestController
@RequestMapping("/api/tasks")
class TaskController {
    private final TaskService tasks;
    private final CollageResults collages;

    TaskController(TaskService tasks, CollageResults collages) {
        this.tasks = tasks;
        this.collages = collages;
    }

    @PostMapping
    ResponseEntity<TaskResponse> submit(@RequestBody Submission submission, HttpServletRequest request) {
        String ownerId = DemoSessionController.requireUserId(request);
        return ResponseEntity.accepted().cacheControl(CacheControl.noStore())
                .body(tasks.submit(ownerId, submission));
    }

    @GetMapping("/{id}")
    ResponseEntity<TaskResponse> get(@PathVariable String id, HttpServletRequest request) {
        String ownerId = DemoSessionController.requireUserId(request);
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(tasks.find(ownerId, taskId(id)));
    }

    @DeleteMapping("/{id}")
    ResponseEntity<Void> delete(@PathVariable String id, HttpServletRequest request) {
        String ownerId = DemoSessionController.requireUserId(request);
        tasks.delete(ownerId, taskId(id));
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }

    @GetMapping("/{id}/result")
    ResponseEntity<FileSystemResource> result(@PathVariable String id, HttpServletRequest request) {
        String ownerId = DemoSessionController.requireUserId(request);
        long taskId = taskId(id);
        TaskResponse task = tasks.find(ownerId, taskId);
        var file = collages.file(taskId);
        if (!"SUCCEEDED".equals(task.status()) || !CollageResults.url(taskId).equals(task.resultUrl())
                || !Files.isRegularFile(file) || !Files.isReadable(file)) {
            throw new ApiException(HttpStatus.NOT_FOUND, "RESULT_NOT_FOUND", "找不到制作结果");
        }
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).contentType(MediaType.IMAGE_PNG)
                .body(new FileSystemResource(file));
    }

    private static long taskId(String id) {
        try {
            return Long.parseLong(id);
        } catch (NumberFormatException invalidId) {
            throw notFound();
        }
    }

    @GetMapping
    ResponseEntity<History> history(@RequestParam(required = false) String templateId,
                                    @RequestParam(required = false) String activeOnly, HttpServletRequest request) {
        String ownerId = DemoSessionController.requireUserId(request);
        if (activeOnly != null && !"true".equals(activeOnly) && !"false".equals(activeOnly)) {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_FILTER", "activeOnly 只接受 true 或 false");
        }
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(new History(tasks.history(ownerId, templateId, "true".equals(activeOnly))));
    }

    static ApiException notFound() {
        return new ApiException(HttpStatus.NOT_FOUND, "TASK_NOT_FOUND", "找不到制作任务");
    }

    record Submission(String templateId, List<String> assetIds, Simulation simulation) {
    }

    record Simulation(Integer stageDelayMs, Stage failAtStage) {
    }

    record History(List<TaskResponse> tasks) {
    }
}
