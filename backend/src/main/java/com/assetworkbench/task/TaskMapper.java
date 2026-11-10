package com.assetworkbench.task;

import com.assetworkbench.task.TaskWorkflow.Stage;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import java.time.Instant;
import java.util.List;

@Mapper
interface TaskMapper {
    String TASK_COLUMNS = """
            SELECT tasks.id, tasks.template_id, templates.title, tasks.created_at,
                   tasks.status, tasks.stage, tasks.stage_delay_ms, tasks.fail_at_stage,
                   templates.result_image, tasks.result_url, tasks.failure_code, tasks.failure_message
            FROM tasks JOIN templates ON tasks.template_id = templates.id
            """;

    @Insert("""
            INSERT INTO tasks (owner_id, template_id, status, stage_delay_ms, fail_at_stage)
            VALUES (#{ownerId}, #{templateId}, 'PENDING', #{delay}, #{failAt})
            """)
    void insertTask(@Param("ownerId") String ownerId, @Param("templateId") String templateId,
                    @Param("delay") int delay, @Param("failAt") Stage failAt);

    @Select("SELECT LAST_INSERT_ID()")
    long lastTaskId();

    @Insert("INSERT INTO task_inputs (task_id, slot, asset_id) VALUES (#{taskId}, #{slot}, #{assetId})")
    void insertInput(@Param("taskId") long taskId, @Param("slot") int slot, @Param("assetId") String assetId);

    @Select(TASK_COLUMNS + " WHERE tasks.id = #{id} AND tasks.owner_id = #{ownerId}")
    TaskRow ownedTask(@Param("id") long id, @Param("ownerId") String ownerId);

    @Select("SELECT status, stage, result_url, failure_code, failure_message FROM tasks WHERE id = #{id}")
    Progress progress(long id);

    @Select("<script>" + TASK_COLUMNS + """
            WHERE tasks.owner_id = #{ownerId}
            <if test="templateId != null">AND tasks.template_id = #{templateId}</if>
            <if test="activeOnly">AND tasks.status IN ('PENDING', 'PROCESSING')</if>
            ORDER BY tasks.id DESC
            </script>
            """)
    List<TaskRow> history(@Param("ownerId") String ownerId, @Param("templateId") String templateId,
                          @Param("activeOnly") boolean activeOnly);

    @Select(TASK_COLUMNS + """
            WHERE tasks.status = 'PENDING'
              AND NOT EXISTS (SELECT 1 FROM tasks AS running WHERE running.status = 'PROCESSING')
            ORDER BY tasks.id LIMIT 1
            """)
    TaskRow firstPending();

    @Select("""
            SELECT assets.storage_name FROM task_inputs JOIN assets ON task_inputs.asset_id = assets.id
            WHERE task_inputs.task_id = #{taskId} ORDER BY task_inputs.slot
            """)
    List<String> inputFiles(long taskId);

    @Update("""
            UPDATE tasks SET status = #{next.status}, stage = #{next.stage},
                result_url = #{next.resultUrl}, failure_code = #{failureCode}, failure_message = #{failureMessage}
            WHERE id = #{id} AND status = #{expectedStatus} AND stage <=> #{expectedStage}
            """)
    int advance(@Param("id") long id, @Param("expectedStatus") String expectedStatus,
                @Param("expectedStage") Stage expectedStage, @Param("next") TaskWorkflow.Update next,
                @Param("failureCode") String failureCode, @Param("failureMessage") String failureMessage);

    @Update("""
            UPDATE tasks SET status = 'FAILED', failure_code = 'PROCESS_INTERRUPTED',
                             failure_message = '服务重启，处理已中断'
            WHERE status = 'PROCESSING'
            """)
    void failInterruptedTasks();

    record TaskRow(long id, String templateId, String templateTitle, Instant createdAt,
                   String status, Stage stage, int stageDelayMs, Stage failAtStage,
                   String resultImage, String resultUrl, String failureCode, String failureMessage) {
        TaskResponse response() {
            TaskWorkflow.Failure failure = failureCode == null
                    ? null : new TaskWorkflow.Failure(failureCode, failureMessage);
            return new TaskResponse(Long.toString(id), templateId, templateTitle, createdAt,
                    status, stage, resultUrl, failure);
        }
    }

    record TaskResponse(String id, String templateId, String templateTitle, Instant createdAt,
                        String status, Stage stage, String resultUrl, TaskWorkflow.Failure failure) {
    }

    record Progress(String status, Stage stage, String resultUrl, String failureCode, String failureMessage) {
    }
}
