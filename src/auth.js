import { expressjwt } from "express-jwt";
import jwksRsa from "jwks-rsa";

const KEYCLOAK_URL = process.env.KEYCLOAK_URL || "http://keycloak:8080";
const REALM = process.env.KEYCLOAK_REALM || "patient-journal";

/**
 * JWT validation middleware using Keycloak's JWKS endpoint.
 * Validates the Bearer token and populates req.auth with the decoded JWT.
 */
export const jwtCheck = expressjwt({
    secret: jwksRsa.expressJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 5,
        jwksUri: `${KEYCLOAK_URL}/realms/${REALM}/protocol/openid-connect/certs`,
    }),
    issuer: [
        `${KEYCLOAK_URL}/realms/${REALM}`,
        `http://localhost:8080/realms/${REALM}`,
        `https://keycloakservice-lab3.app.cloud.cbh.kth.se/auth/realms/${REALM}`,  // <-- LÄGG TILL
    ],
    algorithms: ["RS256"],
});

/**
 * Middleware to require a specific role.
 * Must be used after jwtCheck.
 *
 * @param {string|string[]} roles - Required role(s)
 */
export const requireRole = (roles) => {
    const roleArray = Array.isArray(roles) ? roles : [roles];

    return (req, res, next) => {
        const userRoles = req.auth?.roles || [];

        const hasRole = roleArray.some((role) => userRoles.includes(role));

        if (!hasRole) {
            return res.status(403).json({
                message: "Forbidden: insufficient permissions",
                required: roleArray,
                actual: userRoles,
            });
        }

        next();
    };
};

/**
 * Error handler for JWT validation errors.
 */
export const jwtErrorHandler = (err, req, res, next) => {
    if (err.name === "UnauthorizedError") {
        return res.status(401).json({
            message: "Invalid or missing token",
            error: err.message,
        });
    }
    next(err);
};