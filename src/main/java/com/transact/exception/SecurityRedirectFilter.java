package com.transact.exception;

import jakarta.ws.rs.container.ContainerRequestContext;
import jakarta.ws.rs.container.ContainerResponseContext;
import jakarta.ws.rs.container.ContainerResponseFilter;
import jakarta.ws.rs.core.Cookie;
import jakarta.ws.rs.ext.Provider;

import java.util.Map;

@Provider
public class SecurityRedirectFilter implements ContainerResponseFilter {

    private static final String EXPIRED_DATE = "Thu, 01 Jan 1970 00:00:00 GMT";
    private static final String[] AUTH_COOKIES = {"quarkus-credential", "quarkus-redirect-location", "JSESSIONID"};

    @Override
    public void filter(ContainerRequestContext requestContext,
                       ContainerResponseContext responseContext) {

        int status = responseContext.getStatus();
        String path = requestContext.getUriInfo().getPath();

        if (status == 401) {
            if (!"/login".equals(path)) {
                // Clear only auth-related cookies to prevent stale auth loops
                Map<String, Cookie> cookies = requestContext.getCookies();
                boolean isSecure = "https".equals(requestContext.getUriInfo().getRequestUri().getScheme());
                String secureFlag = isSecure ? "; Secure" : "";
                String httpOnlyFlag = "; HttpOnly";  // Assume HttpOnly for auth cookies
                for (String cookieName : AUTH_COOKIES) {
                    if (cookies.containsKey(cookieName)) {
                        Cookie cookie = cookies.get(cookieName);
                        String cookiePath = cookie.getPath() != null ? cookie.getPath() : "/";
                        String cookieDomain = cookie.getDomain() != null ? "; Domain=" + cookie.getDomain() : "";
                        String setCookie = cookieName + "=; Path=" + cookiePath +
                                cookieDomain +
                                "; Expires=" + EXPIRED_DATE +
                                secureFlag +
                                httpOnlyFlag;
                        responseContext.getHeaders().add("Set-Cookie", setCookie);
                    }
                }

                responseContext.setStatus(302);
                responseContext.getHeaders().putSingle("Location", "/login");
            }
        }
    }
}