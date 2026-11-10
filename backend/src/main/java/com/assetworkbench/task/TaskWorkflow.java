package com.assetworkbench.task;

import java.util.function.Consumer;
import java.util.function.Function;

public final class TaskWorkflow {
    public enum Stage {
        CHECK_ASSETS, GENERATE, FINALIZE
    }

    public enum Status {
        PROCESSING, SUCCEEDED, FAILED
    }

    public record Update(Status status, Stage stage, String resultUrl, Failure failure) {
    }

    public record Failure(String code, String message) {
    }

    public static final class StageFailure extends RuntimeException {
        private final String code;

        public StageFailure(String code, String message) {
            super(message);
            this.code = code;
        }
    }

    /**
     * Executes one claimed task. The update writer returns after recording the update.
     * The final stage returns the preview address.
     */
    public void execute(Function<Stage, String> performStage, Consumer<Update> writeUpdate) {
        String resultUrl = null;
        for (Stage stage : Stage.values()) {
            writeUpdate.accept(new Update(Status.PROCESSING, stage, null, null));
            try {
                resultUrl = performStage.apply(stage);
                if (stage == Stage.FINALIZE && (resultUrl == null || resultUrl.isBlank())) {
                    throw new StageFailure("RESULT_UNAVAILABLE", "结果图片不可用");
                }
            } catch (StageFailure failure) {
                writeUpdate.accept(new Update(
                        Status.FAILED, stage, null, new Failure(failure.code, failure.getMessage())
                ));
                return;
            }
        }
        writeUpdate.accept(new Update(Status.SUCCEEDED, Stage.FINALIZE, resultUrl, null));
    }
}
