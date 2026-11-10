package com.assetworkbench.web;

import com.assetworkbench.persistence.DatabaseAvailability;
import org.slf4j.LoggerFactory;
import org.springframework.dao.DataAccessException;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.transaction.TransactionException;
import org.springframework.web.HttpMediaTypeNotSupportedException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.multipart.MaxUploadSizeExceededException;
import org.springframework.web.multipart.support.MissingServletRequestPartException;

public final class ApiException extends RuntimeException {
    private final HttpStatus status;
    private final String code;

    public ApiException(HttpStatus status, String code, String message) {
        super(message);
        this.status = status;
        this.code = code;
    }

    @RestControllerAdvice
    static class Handler {
        @ExceptionHandler(ApiException.class)
        ResponseEntity<ErrorResponse> apiError(ApiException exception) {
            return error(exception.status, exception.code, exception.getMessage());
        }

        @ExceptionHandler({
                HttpMessageNotReadableException.class,
                MissingServletRequestParameterException.class,
                MissingServletRequestPartException.class
        })
        ResponseEntity<ErrorResponse> invalidRequest() {
            return error(HttpStatus.BAD_REQUEST, "INVALID_REQUEST", "请检查请求参数");
        }

        @ExceptionHandler(MaxUploadSizeExceededException.class)
        ResponseEntity<ErrorResponse> uploadTooLarge() {
            return error(HttpStatus.PAYLOAD_TOO_LARGE, "IMAGE_TOO_LARGE", "图片超过文件大小限制");
        }

        @ExceptionHandler(HttpMediaTypeNotSupportedException.class)
        ResponseEntity<ErrorResponse> unsupportedMediaType() {
            return error(HttpStatus.UNSUPPORTED_MEDIA_TYPE, "UNSUPPORTED_MEDIA_TYPE", "请求格式不受支持");
        }

        @ExceptionHandler({DataAccessException.class, TransactionException.class})
        ResponseEntity<ErrorResponse> persistenceError(RuntimeException failure) {
            if (DatabaseAvailability.isTemporary(failure)) {
                return error(HttpStatus.SERVICE_UNAVAILABLE, "SERVICE_UNAVAILABLE", "服务暂时不可用");
            }
            LoggerFactory.getLogger(Handler.class).error("业务数据写入或读取失败", failure);
            return error(HttpStatus.INTERNAL_SERVER_ERROR, "PERSISTENCE_ERROR", "暂时无法保存或读取记录");
        }

        private ResponseEntity<ErrorResponse> error(HttpStatus status, String code, String message) {
            return ResponseEntity.status(status).cacheControl(CacheControl.noStore())
                    .body(new ErrorResponse(new ErrorDetail(code, message)));
        }
    }

    record ErrorResponse(ErrorDetail error) {
    }

    record ErrorDetail(String code, String message) {
    }
}
