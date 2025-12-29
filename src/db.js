import mysql from "mysql2/promise";

export function createPoolFromEnv() {
    const host = process.env.DB_HOST || "db";
    const port = Number(process.env.DB_PORT || 3306);
    const database = process.env.DB_NAME || "image_db";

    const user = process.env.DB_USER || "imageapp_user";
    const password =
        process.env.DB_PASSWORD ||
        process.env.DB_PASS ||
        "imagepass";

    return mysql.createPool({
        host,
        port,
        database,
        user,
        password,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
    });
}