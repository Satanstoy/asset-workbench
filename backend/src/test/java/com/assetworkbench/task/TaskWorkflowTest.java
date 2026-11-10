package com.assetworkbench.task;

import com.assetworkbench.task.TaskWorkflow.Failure;
import com.assetworkbench.task.TaskWorkflow.Stage;
import com.assetworkbench.task.TaskWorkflow.StageFailure;
import com.assetworkbench.task.TaskWorkflow.Status;
import com.assetworkbench.task.TaskWorkflow.Update;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

import java.util.ArrayList;
import java.util.List;

import static com.assetworkbench.task.TaskWorkflow.Stage.CHECK_ASSETS;
import static com.assetworkbench.task.TaskWorkflow.Stage.FINALIZE;
import static com.assetworkbench.task.TaskWorkflow.Stage.GENERATE;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class TaskWorkflowTest {
    private static final String RESULT_URL = "/api/demo-images/postcard-result.png";
    private final TaskWorkflow workflow = new TaskWorkflow();
    private final List<Update> updates = new ArrayList<>();
    private final List<Stage> executedStages = new ArrayList<>();

    @Test
    void recordsEachStageBeforeExecutingItAndPublishesTheResult() {
        workflow.execute(stage -> {
            assertThat(updates.get(updates.size() - 1)).isEqualTo(processing(stage));
            executedStages.add(stage);
            return stage == FINALIZE ? RESULT_URL : null;
        }, updates::add);

        assertThat(executedStages).containsExactly(CHECK_ASSETS, GENERATE, FINALIZE);
        assertThat(updates).containsExactly(
                processing(CHECK_ASSETS),
                processing(GENERATE),
                processing(FINALIZE),
                new Update(Status.SUCCEEDED, FINALIZE, RESULT_URL, null)
        );
    }

    @ParameterizedTest
    @EnumSource(Stage.class)
    void stopsAfterTheFailedStageAndRecordsTheReason(Stage failedStage) {
        String message = "此制作阶段模拟失败";
        workflow.execute(stage -> {
            executedStages.add(stage);
            if (stage == failedStage) {
                throw new StageFailure("SIMULATED_FAILURE", message);
            }
            return null;
        }, updates::add);

        List<Stage> expectedStages = switch (failedStage) {
            case CHECK_ASSETS -> List.of(CHECK_ASSETS);
            case GENERATE -> List.of(CHECK_ASSETS, GENERATE);
            case FINALIZE -> List.of(CHECK_ASSETS, GENERATE, FINALIZE);
        };
        List<Update> expectedUpdates = new ArrayList<>(
                expectedStages.stream().map(TaskWorkflowTest::processing).toList()
        );
        expectedUpdates.add(new Update(
                Status.FAILED, failedStage, null, new Failure("SIMULATED_FAILURE", message)
        ));
        assertThat(executedStages).containsExactlyElementsOf(expectedStages);
        assertThat(updates).containsExactlyElementsOf(expectedUpdates);
    }

    @Test
    void recordsResultFailureIfFinalizationProducesNoPreviewAddress() {
        workflow.execute(stage -> null, updates::add);

        assertThat(updates).containsExactly(
                processing(CHECK_ASSETS),
                processing(GENERATE),
                processing(FINALIZE),
                new Update(Status.FAILED, FINALIZE, null, new Failure("RESULT_UNAVAILABLE", "结果图片不可用"))
        );
    }

    @Test
    void doesNotExecuteAStageWhenRecordingItsEntryFails() {
        IllegalStateException writeFailure = new IllegalStateException("状态暂时无法保存");

        assertThatThrownBy(() -> workflow.execute(stage -> {
            executedStages.add(stage);
            return null;
        }, update -> {
            if (update.equals(processing(GENERATE))) {
                throw writeFailure;
            }
            updates.add(update);
        })).isSameAs(writeFailure);

        assertThat(executedStages).containsExactly(CHECK_ASSETS);
        assertThat(updates).containsExactly(processing(CHECK_ASSETS));
    }

    private static Update processing(Stage stage) {
        return new Update(Status.PROCESSING, stage, null, null);
    }
}
