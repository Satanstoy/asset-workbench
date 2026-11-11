package com.assetworkbench.task;

import com.assetworkbench.task.TaskMapper.Progress;
import com.assetworkbench.task.TaskMapper.TaskRow;
import com.assetworkbench.task.TaskWorkflow.Stage;
import com.assetworkbench.task.TaskWorkflow.Status;
import com.assetworkbench.task.TaskWorkflow.Update;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.dao.DataAccessResourceFailureException;

import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.nullable;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class TaskWorkerRecoveryTest {
    @TempDir
    Path assets;

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void readsBackAWriteWithUnknownOutcomeBeforeContinuing(boolean alreadyCommitted) throws Exception {
        Files.writeString(assets.resolve("test.png"), "readable fixture");
        TaskMapper mapper = mock(TaskMapper.class);
        when(mapper.firstPending()).thenReturn(new TaskRow(
                1, "demo", "演示", Instant.now(), "PENDING", null, 0, null,
                "task-result.png", null, null, null
        ));
        when(mapper.inputFiles(1)).thenReturn(List.of("test.png"));

        AtomicReference<Progress> durable = new AtomicReference<>(new Progress("PENDING", null, null, null, null));
        List<Update> attempts = new ArrayList<>();
        List<Stage> committedStages = new ArrayList<>();
        when(mapper.progress(1)).thenAnswer(call -> durable.get());
        when(mapper.advance(eq(1L), any(), nullable(Stage.class), any(), nullable(String.class), nullable(String.class)))
                .thenAnswer(call -> {
                    Update update = call.getArgument(3);
                    boolean firstGenerate = update.stage() == Stage.GENERATE
                            && attempts.stream().noneMatch(entry -> entry.stage() == Stage.GENERATE);
                    attempts.add(update);
                    if (!firstGenerate || alreadyCommitted) {
                        durable.set(new Progress(update.status().name(), update.stage(), update.resultUrl(), null, null));
                        if (update.status() == Status.PROCESSING) committedStages.add(update.stage());
                    }
                    if (firstGenerate) throw new DataAccessResourceFailureException("connection lost");
                    return 1;
                });

        TaskWorker worker = new TaskWorker(mapper, assets, new CollageResults(assets));
        worker.start();
        worker.runNext();

        assertThat(committedStages).containsExactly(Stage.CHECK_ASSETS, Stage.GENERATE, Stage.FINALIZE);
        assertThat(attempts.stream().filter(entry -> entry.stage() == Stage.GENERATE).count())
                .isEqualTo(alreadyCommitted ? 1 : 2);
        assertThat(durable.get().status()).isEqualTo("SUCCEEDED");
        verify(mapper).progress(1);
        verify(mapper).inputFiles(1);
        verify(mapper, times(1)).firstPending();
    }
}
