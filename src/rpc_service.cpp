// Headless local JSON-RPC service for the web UI prototype.
// Speaks newline-delimited JSON on stdin/stdout, mirroring the Node runtime IPC.
// Long-lived state: BookingService keeps captcha/SMS/login state; Service keeps
// the query session. --fixture returns synthetic data for a full offline demo.
#include "booking_service.h"
#include "booking_session_store.h"
#include "native_service.h"
#include <QCoreApplication>
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonArray>
#include <QImage>
#include <QBuffer>
#include <QTextStream>
#include <QFileInfo>
#include <QDir>
#include <QDate>
#include <cstdio>
#include <memory>

using namespace native;

static QString arg(const QStringList &args, const QString &key, const QString &fallback = QString()) {
 for (int i = 0; i + 1 < args.size(); ++i) if (args[i] == key) return args[i + 1];
 return fallback;
}
static bool has(const QStringList &args, const QString &key) { return args.contains(key); }

static QString defaultRoot() {
 QDir dir(QCoreApplication::applicationDirPath());
 for (int level = 0; level < 7; ++level) {
  if (QFileInfo(dir.filePath("data/hospitals.csv")).isFile()) return dir.absolutePath();
  if (!dir.cdUp()) break;
 }
 return QCoreApplication::applicationDirPath();
}
static QByteArray jsonBytes(const QJsonObject &o) { return QJsonDocument(o).toJson(QJsonDocument::Compact); }
static Response jsonResponse(const QJsonObject &data, const QString &endpoint) {
 return {200, jsonBytes({{QStringLiteral("code"), QStringLiteral("0000")}, {QStringLiteral("data"), data}}), endpoint, QByteArray("application/json")};
}

// Synthetic query fixtures (self-contained; no network).
static QJsonObject fixtureDepartments(const QString &code) {
 QJsonArray deps;
 const QStringList names = {QString::fromUtf8("内科"), QString::fromUtf8("外科"), QString::fromUtf8("内分泌科"), QString::fromUtf8("骨科")};
 const QStringList codes = {"D001", "D002", "D003", "D004"};
 const QStringList first = {"F1", "F2", "F3", "F4"};
 const QStringList firstNames = {QString::fromUtf8("内科"), QString::fromUtf8("外科"), QString::fromUtf8("内科"), QString::fromUtf8("骨科")};
 for (int i = 0; i < names.size(); ++i)
  deps.append(QJsonObject{{QStringLiteral("code"), codes[i]}, {QStringLiteral("name"), names[i]},
    {QStringLiteral("first_department_code"), first[i]}, {QStringLiteral("first_department_name"), firstNames[i]}});
 QJsonObject o{{QStringLiteral("status"), QStringLiteral("complete")}, {QStringLiteral("business_success"), true},
   {QStringLiteral("hospital_code"), code}, {QStringLiteral("hospital_name"), QString::fromUtf8("演示医院")},
   {QStringLiteral("departments"), deps}, {QStringLiteral("rows"), QJsonArray()},
   {QStringLiteral("result_kind"), QStringLiteral("departments")},
   {QStringLiteral("message"), QString::fromUtf8("科室已加载（演示数据）。")},
   {QStringLiteral("metadata_cache_source"), QStringLiteral("fixture")}};
 return o;
}
static QJsonObject fixtureAvailability(const QJsonObject &params, bool plan) {
 QJsonArray rows;
 const QString department = params.value(QStringLiteral("department_code")).toString();
 auto addRows = [&](const QString &date, int seed) {
  const QStringList doctors = {QString::fromUtf8("张医生"), QString::fromUtf8("李医生"), QString::fromUtf8("王医生")};
  for (int i = 0; i < doctors.size(); ++i) {
   QJsonObject route{{QStringLiteral("hosCode"), params.value(QStringLiteral("hospital_code")).toString()},
     {QStringLiteral("doctorCode"), QString("fixture-%1-%2").arg(date).arg(i)},
     {QStringLiteral("uniqueProductKey"), QString("P%1%2").arg(date).arg(i)},
     {QStringLiteral("uniqueProductTimeKey"), QString("T%1%2").arg(date).arg(i)},
     {QStringLiteral("dept1Code"), params.value(QStringLiteral("first_department_code")).toString()},
     {QStringLiteral("dept2Code"), department}, {QStringLiteral("dutyDate"), date}};
   const bool waitlist = i == 2; // one demo row is in official "候补" state
   rows.append(QJsonObject{{QStringLiteral("date"), date}, {QStringLiteral("department_code"), department},
     {QStringLiteral("department_name"), QString::fromUtf8("演示科室")},
     {QStringLiteral("doctor_name"), doctors[i]}, {QStringLiteral("doctor_title"), QString::fromUtf8("主任医师")},
     {QStringLiteral("period"), i % 2 ? QString::fromUtf8("下午") : QString::fromUtf8("上午")},
     {QStringLiteral("registration_fee"), 50.0},
     {QStringLiteral("remaining"), waitlist ? QJsonValue(QJsonValue::Null) : QJsonValue(3 + ((seed + i) % 5))},
     {QStringLiteral("status"), waitlist ? QString::fromUtf8("候补") : QString::fromUtf8("有号")},
     {QStringLiteral("product_status"), waitlist ? 8 : 1},
     {QStringLiteral("queried_at"), QDateTime::currentDateTimeUtc().toString(Qt::ISODateWithMs)},
     {QStringLiteral("booking_supported"), true}, {QStringLiteral("booking_payload"), route},
     {QStringLiteral("row_kind"), QStringLiteral("doctor_period")}});
  }
 };
 if (plan) {
  const QJsonArray dates = params.value(QStringLiteral("dates")).toArray();
  QJsonArray detail;
  for (int d = 0; d < dates.size(); ++d) { const QString date = dates[d].toString(); addRows(date, d); detail.append(date); }
  QJsonObject o = fixtureDepartments(params.value(QStringLiteral("hospital_code")).toString());
  o[QStringLiteral("result_kind")] = QStringLiteral("availability_plan");
  o[QStringLiteral("detail_dates")] = detail;
  o[QStringLiteral("calendar_rows")] = QJsonArray();
  o[QStringLiteral("hospital_system")] = QStringLiteral("new");
  return o;
 }
 const QString date = params.value(QStringLiteral("date")).toString();
 addRows(date, 0);
 QJsonObject o = fixtureDepartments(params.value(QStringLiteral("hospital_code")).toString());
 o[QStringLiteral("result_kind")] = QStringLiteral("availability");
 o[QStringLiteral("rows")] = rows;
 return o;
}

int main(int argc, char **argv) {
 QCoreApplication app(argc, argv);
 // Match the legacy Qt application so the web UI reads the *same* saved session.
 app.setOrganizationName(QStringLiteral("HospitalBooking"));
 app.setApplicationName(QStringLiteral("HospitalBooking"));
 const QStringList args = app.arguments();
 const QString root = QDir(arg(args, QStringLiteral("--root"), defaultRoot())).absolutePath();
 const bool fixture = has(args, QStringLiteral("--fixture"));

 QByteArray captchaPng;
 {
  QImage image(200, 100, QImage::Format_RGB32);
  image.fill(QColor(230, 240, 250));
  QBuffer buffer(&captchaPng);
  buffer.open(QIODevice::WriteOnly);
  image.save(&buffer, "PNG");
 }

 BookingService::Transport fake;
 if (fixture) {
  fake = [captchaPng](QString, QString endpoint, QJsonObject, QJsonObject) -> Response {
   const QString e = endpoint;
   if (e.endsWith(QStringLiteral("/captcha"))) return {200, captchaPng, e, QByteArray("image/png")};
   if (e.endsWith(QStringLiteral("/phoneCode"))) return jsonResponse(QJsonObject{{QStringLiteral("time"), 60}}, e);
   if (e.endsWith(QStringLiteral("/phoneLogin"))) return jsonResponse(QJsonObject{}, e);
   if (e.endsWith(QStringLiteral("/user/get"))) return jsonResponse(QJsonObject{{QStringLiteral("userId"), QStringLiteral("fixture-user")}, {QStringLiteral("authStatus"), 1}}, e);
   if (e.endsWith(QStringLiteral("/patient/list"))) {
    QJsonArray patients{QJsonObject{{QStringLiteral("patientId"), QStringLiteral("fixture-patient")},
      {QStringLiteral("patientName"), QString::fromUtf8("测试患者")}, {QStringLiteral("patientNameConfound"), QString::fromUtf8("测**")},
      {QStringLiteral("idCardType"), 1}, {QStringLiteral("nationCode"), 1},
      {QStringLiteral("faceVerifyResult"), QStringLiteral("passed")}, {QStringLiteral("virtualPhone"), false},
      {QStringLiteral("cardList"), QJsonArray{QJsonObject{{QStringLiteral("cardNo"), QStringLiteral("fixture-card-1234")},
        {QStringLiteral("medicareType"), 1}, {QStringLiteral("medicareTypeView"), QString::fromUtf8("测试就诊卡")},
        {QStringLiteral("default_card"), 1}}}}}};
    return jsonResponse(QJsonObject{{QStringLiteral("patientList"), patients}}, e);
   }
   if (e.endsWith(QStringLiteral("/logout"))) return jsonResponse(QJsonObject{}, e);
   return {200, jsonBytes({{QStringLiteral("code"), QStringLiteral("0000")}}), e, QByteArray("application/json")};
  };
 }

 auto booking = std::make_unique<BookingService>(root, fake);
 auto query = std::make_unique<Service>(root);
 std::atomic_bool cancel(false);

 QTextStream in(stdin); in.setCodec("UTF-8");
 QTextStream out(stdout); out.setCodec("UTF-8");
 out << QJsonDocument(QJsonObject{{QStringLiteral("event"), QStringLiteral("ready")},
     {QStringLiteral("fixture"), fixture},
     {QStringLiteral("session_path"), BookingSessionStore::defaultPath()},
     {QStringLiteral("has_saved_session"), BookingSessionStore::hasSavedSession()}}).toJson(QJsonDocument::Compact) << '\n';
 out.flush();

 auto reply = [&](const QString &id, const QString &op, QJsonObject response) {
  response.insert(QStringLiteral("ok"), response.value(QStringLiteral("status")) == QJsonValue(QStringLiteral("complete"))
    || response.value(QStringLiteral("status")) == QJsonValue(QStringLiteral("ready")));
  response.insert(QStringLiteral("id"), id);
  response.insert(QStringLiteral("op"), op);
  out << QJsonDocument(response).toJson(QJsonDocument::Compact) << '\n';
  out.flush();
 };

 while (!in.atEnd()) {
  const QString line = in.readLine();
  if (line.trimmed().isEmpty()) continue;
  QJsonParseError error;
  const QJsonDocument request = QJsonDocument::fromJson(line.toUtf8(), &error);
  if (error.error != QJsonParseError::NoError || !request.isObject()) {
   out << QJsonDocument(QJsonObject{{QStringLiteral("error"), QStringLiteral("invalid_request")}}).toJson(QJsonDocument::Compact) << '\n';
   out.flush(); continue;
  }
  const QJsonObject obj = request.object();
  const QString op = obj.value(QStringLiteral("op")).toString();
  const QJsonObject params = obj.value(QStringLiteral("params")).toObject();
  QString id = obj.value(QStringLiteral("id")).toString();
  if (id.isEmpty()) id = QStringLiteral("rpc");
  QJsonObject response;
  try {
   const bool queryOp = op == QStringLiteral("departments") || op == QStringLiteral("availability")
     || op == QStringLiteral("availability_plan") || op == QStringLiteral("prewarm");
   if (queryOp) {
    if (fixture) {
     if (op == QStringLiteral("departments")) response = fixtureDepartments(params.value(QStringLiteral("hospital_code")).toString());
     else if (op == QStringLiteral("prewarm")) response = QJsonObject{{QStringLiteral("status"), QStringLiteral("ready")}, {QStringLiteral("prewarm_complete"), true}};
     else response = fixtureAvailability(params, op == QStringLiteral("availability_plan"));
     if (!response.contains(QStringLiteral("performance")))
      response[QStringLiteral("performance")] = QJsonObject{{QStringLiteral("http_dispatches"), 0}};
    } else {
     response = query->execute(op, params, &cancel);
    }
   } else {
    response = booking->execute(op, params, &cancel);
   }
   reply(id, op, response);
  } catch (const std::exception &e) {
   reply(id, op, QJsonObject{{QStringLiteral("status"), QStringLiteral("failed")},
     {QStringLiteral("failure"), QString::fromUtf8(e.what())}, {QStringLiteral("message"), QString::fromUtf8(e.what())}});
  } catch (...) {
   reply(id, op, QJsonObject{{QStringLiteral("status"), QStringLiteral("failed")}, {QStringLiteral("failure"), QStringLiteral("unknown_error")}});
  }
 }
 booking->close();
 query->close();
 return 0;
}
