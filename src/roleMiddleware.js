function roleMiddleware(requiredRole) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        status: "error",
        message: "Unauthorized",
      });
    }

    if (req.user.role !== requiredRole) {
      return res.status(403).json({
        status: "error",
        message: "Forbidden",
      });
    }

    return next();
  };
}

module.exports = roleMiddleware;
