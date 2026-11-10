package com.assetworkbench.persistence;

import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.dao.RecoverableDataAccessException;
import org.springframework.dao.TransientDataAccessException;
import org.springframework.jdbc.CannotGetJdbcConnectionException;

import java.sql.SQLException;
import java.sql.SQLRecoverableException;
import java.sql.SQLTransientException;

public final class DatabaseAvailability {
    private DatabaseAvailability() {
    }

    public static boolean isTemporary(Throwable error) {
        // MyBatis can wrap the connection failure instead of translating the outer exception.
        for (Throwable cause = error; cause != null; cause = cause.getCause()) {
            if (cause instanceof TransientDataAccessException
                    || cause instanceof DataAccessResourceFailureException
                    || cause instanceof RecoverableDataAccessException
                    || cause instanceof CannotGetJdbcConnectionException
                    || cause instanceof SQLTransientException
                    || cause instanceof SQLRecoverableException
                    || (cause instanceof SQLException sql && sql.getSQLState() != null
                    && sql.getSQLState().startsWith("08"))) {
                return true;
            }
        }
        return false;
    }
}
