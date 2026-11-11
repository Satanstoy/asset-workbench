CREATE TABLE IF NOT EXISTS templates (
    id VARCHAR(64) PRIMARY KEY,
    title VARCHAR(120) NOT NULL,
    category VARCHAR(120) NOT NULL,
    cover_image VARCHAR(120) NOT NULL,
    description VARCHAR(500) NOT NULL,
    required_image_count INT NOT NULL,
    accepted_mime_types VARCHAR(120) NOT NULL DEFAULT 'image/jpeg,image/png',
    max_file_size_bytes BIGINT NOT NULL DEFAULT 5242880,
    max_image_pixels BIGINT NOT NULL DEFAULT 25000000,
    result_image VARCHAR(120) NOT NULL,
    CONSTRAINT templates_valid_limits CHECK (
        required_image_count > 0 AND max_file_size_bytes > 0 AND max_image_pixels > 0
    )
);

CREATE TABLE IF NOT EXISTS assets (
    id VARCHAR(64) PRIMARY KEY,
    owner_id VARCHAR(16) NOT NULL,
    mime_type VARCHAR(32) NOT NULL,
    size_bytes BIGINT NOT NULL,
    width INT NOT NULL,
    height INT NOT NULL,
    storage_name VARCHAR(255) NOT NULL UNIQUE,
    CONSTRAINT assets_valid_image CHECK (size_bytes > 0 AND width > 0 AND height > 0)
);

CREATE TABLE IF NOT EXISTS tasks (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    owner_id VARCHAR(16) NOT NULL,
    template_id VARCHAR(64) NOT NULL,
    created_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    status VARCHAR(16) NOT NULL,
    stage VARCHAR(16),
    stage_delay_ms INT NOT NULL,
    fail_at_stage VARCHAR(16),
    result_url VARCHAR(255),
    failure_code VARCHAR(48),
    failure_message VARCHAR(255),
    INDEX tasks_queue (status, id),
    INDEX tasks_owner_history (owner_id, id),
    CONSTRAINT tasks_valid_delay CHECK (stage_delay_ms BETWEEN 0 AND 10000),
    CONSTRAINT tasks_valid_stage CHECK (stage IS NULL OR stage IN ('CHECK_ASSETS', 'GENERATE', 'FINALIZE')),
    CONSTRAINT tasks_valid_simulation CHECK (fail_at_stage IS NULL OR fail_at_stage IN ('CHECK_ASSETS', 'GENERATE', 'FINALIZE')),
    CONSTRAINT tasks_consistent_outcome CHECK (
        (status = 'PENDING' AND stage IS NULL AND result_url IS NULL AND failure_code IS NULL AND failure_message IS NULL)
        OR (status = 'PROCESSING' AND stage IS NOT NULL AND result_url IS NULL AND failure_code IS NULL AND failure_message IS NULL)
        OR (status = 'SUCCEEDED' AND stage IS NOT NULL AND stage = 'FINALIZE' AND result_url IS NOT NULL
            AND failure_code IS NULL AND failure_message IS NULL)
        OR (status = 'FAILED' AND stage IS NOT NULL AND result_url IS NULL
            AND failure_code IS NOT NULL AND failure_message IS NOT NULL)
    ),
    CONSTRAINT tasks_template_fk FOREIGN KEY (template_id) REFERENCES templates (id)
);

CREATE TABLE IF NOT EXISTS task_inputs (
    task_id BIGINT NOT NULL,
    slot INT NOT NULL,
    asset_id VARCHAR(64) NOT NULL,
    PRIMARY KEY (task_id, slot),
    CONSTRAINT task_inputs_valid_slot CHECK (slot >= 0),
    CONSTRAINT task_inputs_task_fk FOREIGN KEY (task_id) REFERENCES tasks (id),
    CONSTRAINT task_inputs_asset_fk FOREIGN KEY (asset_id) REFERENCES assets (id)
);

CREATE TABLE IF NOT EXISTS deleted_tasks (
    task_id BIGINT PRIMARY KEY,
    deleted_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
    CONSTRAINT deleted_tasks_task_fk FOREIGN KEY (task_id) REFERENCES tasks (id)
);
