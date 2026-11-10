package com.assetworkbench.task;

import com.fasterxml.jackson.databind.JsonNode;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.HttpEntity;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.JdbcTemplate;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

@EnabledIfEnvironmentVariable(named = "TEST_DB_URL", matches = ".+")
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "spring.datasource.url=${TEST_DB_URL}",
        "spring.datasource.username=${TEST_DB_USER:workbench}",
        "spring.datasource.password=${TEST_DB_PASSWORD:workbench-test}",
        "workbench.assets-directory=target/http-test-assets",
        "workbench.simulation-enabled=true"
})
class TaskHttpIntegrationTest {
    private static final String RESULT_IMAGE = "task-result.png";

    @Autowired
    private TestRestTemplate http;

    @Autowired
    private JdbcTemplate database;

    @Value("${workbench.assets-directory}")
    private Path assetsDirectory;

    @Test
    void acceptsAndPersistsARequestThenExposesTheRealWorkerStages() throws IOException {
        String session = signIn("demo-a");
        Fixture fixture = seedFixture();

        JsonNode accepted = submit(session, fixture, Map.of("stageDelayMs", 800));
        String taskId = accepted.path("id").asText();
        assertThat(accepted.path("id").isTextual()).isTrue();
        assertThat(accepted.path("templateId").asText()).isEqualTo(fixture.templateId());
        assertThat(accepted.path("templateTitle").asText()).isEqualTo("HTTP 测试模板");
        assertThat(Instant.parse(accepted.path("createdAt").asText())).isBeforeOrEqualTo(Instant.now());
        assertThat(accepted.path("status").asText()).isEqualTo("PENDING");
        assertThat(accepted.path("stage").isNull()).isTrue();
        assertThat(accepted.path("resultUrl").isNull()).isTrue();
        assertThat(accepted.path("failure").isNull()).isTrue();

        assertThat(database.queryForObject(
                "SELECT owner_id FROM tasks WHERE id = ?", String.class, Long.parseLong(taskId)
        )).isEqualTo("demo-a");
        assertThat(database.queryForList(
                "SELECT asset_id FROM task_inputs WHERE task_id = ? ORDER BY slot",
                String.class, Long.parseLong(taskId)
        )).containsExactly(fixture.assetId(), fixture.assetId());

        awaitTask(session, taskId, "PROCESSING", "CHECK_ASSETS");
        awaitTask(session, taskId, "PROCESSING", "GENERATE");
        awaitTask(session, taskId, "PROCESSING", "FINALIZE");
        JsonNode finished = awaitTask(session, taskId, "SUCCEEDED", "FINALIZE");
        assertThat(finished.path("failure").isNull()).isTrue();
        assertThat(database.queryForObject(
                "SELECT status FROM tasks WHERE id = ?", String.class, Long.parseLong(taskId)
        )).isEqualTo("SUCCEEDED");
        ResponseEntity<byte[]> preview = http.getForEntity(finished.path("resultUrl").asText(), byte[].class);
        assertThat(preview.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(preview.getHeaders().getContentType().toString()).isEqualTo("image/png");
        assertThat(preview.getBody()).isNotEmpty();
    }

    @Test
    void keepsTheSecondTaskWaitingThenRunsItAfterTheFirstFails() throws IOException {
        String session = signIn("demo-a");
        Fixture fixture = seedFixture();
        String first = submit(session, fixture, Map.of("stageDelayMs", 700, "failAtStage", "GENERATE"))
                .path("id").asText();
        String second = submit(session, fixture, Map.of("stageDelayMs", 0)).path("id").asText();

        awaitTask(session, first, "PROCESSING", "GENERATE");
        assertThat(readTask(session, second).path("status").asText()).isEqualTo("PENDING");
        JsonNode failed = awaitTask(session, first, "FAILED", "GENERATE");
        assertThat(failed.path("failure").path("code").asText()).isEqualTo("SIMULATED_FAILURE");
        assertThat(failed.path("failure").path("message").asText()).isNotBlank();
        assertThat(failed.path("resultUrl").isNull()).isTrue();
        awaitTask(session, second, "SUCCEEDED", "FINALIZE");
    }

    @Test
    void deniesOtherIdentitiesAndRejectsInvalidInputWithoutCreatingATask() throws IOException {
        String owner = signIn("demo-a");
        String other = signIn("demo-b");
        Fixture fixture = seedFixture();
        String taskId = submit(owner, fixture, Map.of("stageDelayMs", 0)).path("id").asText();

        ResponseEntity<JsonNode> forbidden = request(other, HttpMethod.GET, "/api/tasks/" + taskId, null);
        assertThat(forbidden.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(forbidden.getHeaders().getCacheControl()).contains("no-store");
        assertThat(request(null, HttpMethod.GET, "/api/tasks/" + taskId, null).getStatusCode())
                .isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(request(other, HttpMethod.POST, "/api/tasks", taskRequest(fixture, Map.of())).getStatusCode())
                .isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(database.queryForObject(
                "SELECT COUNT(*) FROM tasks WHERE template_id = ?", Integer.class, fixture.templateId()
        )).isEqualTo(1);
        awaitTask(owner, taskId, "SUCCEEDED", "FINALIZE");
    }

    private String signIn(String userId) {
        ResponseEntity<JsonNode> response = request(null, HttpMethod.POST, "/api/session", Map.of("userId", userId));
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        assertThat(response.getBody().path("user").path("id").asText()).isEqualTo(userId);
        String cookie = response.getHeaders().getFirst(HttpHeaders.SET_COOKIE);
        assertThat(cookie).contains("HttpOnly");
        return cookie.split(";", 2)[0];
    }

    private JsonNode submit(String session, Fixture fixture, Map<String, ?> simulation) {
        ResponseEntity<JsonNode> response = request(session, HttpMethod.POST, "/api/tasks",
                taskRequest(fixture, simulation));
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.ACCEPTED);
        return response.getBody();
    }

    private Map<String, ?> taskRequest(Fixture fixture, Map<String, ?> simulation) {
        return Map.of("templateId", fixture.templateId(), "assetIds", List.of(fixture.assetId(), fixture.assetId()),
                "simulation", simulation);
    }

    private JsonNode awaitTask(String session, String taskId, String status, String stage) {
        return await().pollInterval(Duration.ofMillis(30)).atMost(Duration.ofSeconds(8))
                .until(() -> readTask(session, taskId), task ->
                        status.equals(task.path("status").asText()) && stage.equals(task.path("stage").asText()));
    }

    private JsonNode readTask(String session, String taskId) {
        ResponseEntity<JsonNode> response = request(session, HttpMethod.GET, "/api/tasks/" + taskId, null);
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
        return response.getBody();
    }

    private ResponseEntity<JsonNode> request(String session, HttpMethod method, String path, Object body) {
        HttpHeaders headers = new HttpHeaders();
        if (session != null) {
            headers.set(HttpHeaders.COOKIE, session);
        }
        return http.exchange(path, method, new HttpEntity<>(body, headers), JsonNode.class);
    }

    private Fixture seedFixture() throws IOException {
        String templateId = UUID.randomUUID().toString();
        String assetId = UUID.randomUUID().toString();
        Files.createDirectories(assetsDirectory);
        Path image = assetsDirectory.resolve(assetId + ".png");
        try (var resource = new ClassPathResource("demo-images/" + RESULT_IMAGE).getInputStream()) {
            Files.copy(resource, image);
        }
        database.update("""
                INSERT INTO templates (id, title, category, cover_image, description, required_image_count, result_image)
                VALUES (?, ?, '测试', ?, 'HTTP 集成测试模板', 2, ?)
                """, templateId, "HTTP 测试模板", RESULT_IMAGE, RESULT_IMAGE);
        database.update("""
                INSERT INTO assets (id, owner_id, mime_type, size_bytes, width, height, storage_name)
                VALUES (?, 'demo-a', 'image/png', ?, 1, 1, ?)
                """, assetId, Files.size(image), image.getFileName().toString());
        return new Fixture(templateId, assetId);
    }

    private record Fixture(String templateId, String assetId) {
    }
}
