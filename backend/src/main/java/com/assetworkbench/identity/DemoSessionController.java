package com.assetworkbench.identity;

import com.assetworkbench.web.ApiException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpSession;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/session")
public class DemoSessionController {
    private static final String USER = "demoUser";

    @GetMapping
    ResponseEntity<SessionResponse> session(HttpServletRequest request) {
        return response(currentUser(request));
    }

    @PostMapping
    ResponseEntity<SessionResponse> select(@RequestBody SelectIdentity body, HttpServletRequest request) {
        User user;
        if ("demo-a".equals(body.userId())) {
            user = new User("demo-a", "演示用户 A");
        } else if ("demo-b".equals(body.userId())) {
            user = new User("demo-b", "演示用户 B");
        } else {
            throw new ApiException(HttpStatus.BAD_REQUEST, "INVALID_IDENTITY", "请选择演示身份 A 或 B");
        }

        HttpSession previous = request.getSession(false);
        if (previous != null) {
            previous.invalidate();
        }
        request.getSession(true).setAttribute(USER, user);
        return response(user);
    }

    public static String requireUserId(HttpServletRequest request) {
        User user = currentUser(request);
        if (user == null) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "SESSION_REQUIRED", "请选择演示身份");
        }
        return user.id();
    }

    private static User currentUser(HttpServletRequest request) {
        HttpSession session = request.getSession(false);
        if (session == null) {
            return null;
        }
        try {
            return (User) session.getAttribute(USER);
        } catch (IllegalStateException invalidated) {
            return null;
        }
    }

    private ResponseEntity<SessionResponse> response(User user) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore()).body(new SessionResponse(user));
    }

    record SelectIdentity(String userId) {
    }

    record SessionResponse(User user) {
    }

    record User(String id, String displayName) {
    }
}
