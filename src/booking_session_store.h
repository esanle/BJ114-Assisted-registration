#pragma once
#include <QByteArray>
#include <QCryptographicHash>
#include <QDateTime>
#include <QDir>
#include <QFile>
#include <QFileInfo>
#include <QJsonArray>
#include <QJsonDocument>
#include <QJsonObject>
#include <QJsonParseError>
#include <QLibrary>
#include <QSaveFile>
#include <QSet>
#include <QStandardPaths>
#include <QString>
#include <cmath>
#include <stdexcept>
#ifdef Q_OS_WIN
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#include <wincrypt.h>
#include <aclapi.h>
#endif
#ifdef Q_OS_MACOS
#include <unistd.h>
#include <sys/stat.h>
#include <CommonCrypto/CommonCrypto.h>
#include <Security/Security.h>
#endif
namespace native {
// Only official session cookies enter this encrypted store. No user/phone/patient payloads.
class BookingSessionStore {
public:
 struct LoadResult {QString state=QStringLiteral("missing");QJsonArray cookies;};
 static QString defaultPath(){const auto base=QStandardPaths::writableLocation(QStandardPaths::AppLocalDataLocation);return base.isEmpty()?QString():QDir(base).filePath(QStringLiteral("official-session/session.dpapi"));}
 static bool hasSavedSession(){return hasSavedSessionAt(defaultPath());}
 static bool hasSavedSessionAt(const QString &path){const QFileInfo f(path);return !path.isEmpty()&&f.isFile()&&!f.isSymLink()&&f.size()>8&&f.size()<=MaxCipher;}
 static bool remove(const QString &overridePath=QString()){const auto p=chosenPath(overridePath);return p.isEmpty()||!QFileInfo::exists(p)||QFile::remove(p);}
 static QString storageDescription(){
#ifdef Q_OS_WIN
  return QStringLiteral("Windows CurrentUser DPAPI");
#elif defined(Q_OS_MACOS)
  return QStringLiteral("macOS Keychain (AES-256-CBC + HMAC-SHA256)");
#else
  return QStringLiteral("unavailable");
#endif
 }
 static QJsonArray validatedCookies(const QJsonArray &input){
  require(!input.isEmpty()&&input.size()<=128);QJsonArray out;QSet<QString> seen;int total=0;
  const QSet<QString> allowed={QStringLiteral("key"),QStringLiteral("name"),QStringLiteral("value"),QStringLiteral("domain"),QStringLiteral("path"),QStringLiteral("hostOnly"),QStringLiteral("domainSpecified"),QStringLiteral("domainInitialDot"),QStringLiteral("pathSpecified"),QStringLiteral("secure"),QStringLiteral("httpOnly"),QStringLiteral("expires"),QStringLiteral("discard"),QStringLiteral("sameSite"),QStringLiteral("creation"),QStringLiteral("lastAccessed")};
  for(const auto &v:input){require(v.isObject());const auto c=v.toObject();for(auto i=c.begin();i!=c.end();++i)require(allowed.contains(i.key()));
   const QString key=c.value(QStringLiteral("key")).toString(c.value(QStringLiteral("name")).toString()),value=c.value(QStringLiteral("value")).toString(),domain=c.value(QStringLiteral("domain")).toString().toLower(),path=c.value(QStringLiteral("path")).toString();
   require(!key.isEmpty()&&key.size()<=256&&c.value(QStringLiteral("value")).isString()&&value.size()<=16384);require(domain==QStringLiteral("114yygh.com")||domain==QStringLiteral("www.114yygh.com"));require(!path.isEmpty()&&path.startsWith(QLatin1Char('/'))&&path.size()<=2048);
   for(QChar x:key)require(x.unicode()>32&&x.unicode()<127&&!QStringLiteral("()<>@,;:\\\"/[]?={}").contains(x));for(QChar x:value)require(x.unicode()>=32&&x.unicode()!=127&&x!=QLatin1Char(';'));for(QChar x:path)require(x.unicode()>=32&&x.unicode()!=127);
   for(const auto &field:{QStringLiteral("hostOnly"),QStringLiteral("secure"),QStringLiteral("httpOnly")})require(c.value(field).isBool());const bool host=c.value(QStringLiteral("hostOnly")).toBool();if(c.contains(QStringLiteral("domainSpecified")))require(c.value(QStringLiteral("domainSpecified")).isBool()&&c.value(QStringLiteral("domainSpecified")).toBool()!=host);
   const auto expires=c.value(QStringLiteral("expires"));require(expires.isNull()||(expires.isDouble()&&std::isfinite(expires.toDouble())&&expires.toDouble()>=0&&expires.toDouble()<=253402300799.0));const auto same=c.value(QStringLiteral("sameSite"));require(same.isNull()||(same.isString()&&(same.toString()==QStringLiteral("strict")||same.toString()==QStringLiteral("lax")||same.toString()==QStringLiteral("none"))));
   const QString id=key+QChar(0)+domain+QChar(0)+path;require(!seen.contains(id));seen.insert(id);total+=key.size()+value.size()+domain.size()+path.size();require(total<=MaxPlain);
   if(expires.isDouble()&&expires.toDouble()<=QDateTime::currentSecsSinceEpoch())continue;
   out.append(QJsonObject{{QStringLiteral("key"),key},{QStringLiteral("value"),value},{QStringLiteral("domain"),domain},{QStringLiteral("path"),path},{QStringLiteral("hostOnly"),host},{QStringLiteral("domainSpecified"),!host},{QStringLiteral("secure"),c.value(QStringLiteral("secure"))},{QStringLiteral("httpOnly"),c.value(QStringLiteral("httpOnly"))},{QStringLiteral("expires"),expires},{QStringLiteral("sameSite"),same}});
  }require(!out.isEmpty());return out;
 }
 static bool save(const QJsonArray &input,const QString &overridePath=QString()){
  QByteArray plain;try{const auto cookies=validatedCookies(input);const auto owner=currentOwner();require(!owner.isEmpty());plain=QJsonDocument(QJsonObject{{QStringLiteral("schema"),1},{QStringLiteral("app"),QStringLiteral("HospitalBooking.OfficialSession")},{QStringLiteral("owner"),owner},{QStringLiteral("cookies"),cookies}}).toJson(QJsonDocument::Compact);require(plain.size()<=MaxPlain);const auto encrypted=protect(plain,false);wipe(plain);require(!encrypted.isEmpty()&&encrypted.size()+8<=MaxCipher);const auto p=chosenPath(overridePath);require(!p.isEmpty());QDir parent=QFileInfo(p).absoluteDir();require(parent.mkpath(QStringLiteral(".")));require(safeFilePath(p));if(QFileInfo::exists(p))require(ownedFile(p,owner));QSaveFile f(p);f.setDirectWriteFallback(false);require(f.open(QIODevice::WriteOnly));f.setPermissions(QFileDevice::ReadOwner|QFileDevice::WriteOwner);const auto bytes=QByteArray("HBSESS1\n",8)+encrypted;require(f.write(bytes)==bytes.size());require(f.commit());require(ensureFileOwner(p,owner));require(ownedFile(p,owner));return true;}catch(...){wipe(plain);return false;}
 }
 static LoadResult load(const QString &overridePath=QString()){
  const auto p=chosenPath(overridePath);if(p.isEmpty()||!QFileInfo::exists(p))return {};QByteArray plain;
  try{const auto owner=currentOwner();require(!owner.isEmpty()&&safeFilePath(p)&&ownedFile(p,owner));QFile f(p);require(f.open(QIODevice::ReadOnly)&&f.size()>8&&f.size()<=MaxCipher);const auto bytes=f.read(MaxCipher+1);require(bytes.size()>8&&bytes.size()<=MaxCipher&&bytes.startsWith(QByteArray("HBSESS1\n",8)));plain=protect(bytes.mid(8),true);require(!plain.isEmpty()&&plain.size()<=MaxPlain);QJsonParseError e;const auto doc=QJsonDocument::fromJson(plain,&e);wipe(plain);require(e.error==QJsonParseError::NoError&&doc.isObject());const auto o=doc.object();require(o.size()==4&&o.value(QStringLiteral("schema"))==QJsonValue(1)&&o.value(QStringLiteral("app"))==QJsonValue(QStringLiteral("HospitalBooking.OfficialSession"))&&o.value(QStringLiteral("owner"))==QJsonValue(owner)&&o.value(QStringLiteral("cookies")).isArray());return {QStringLiteral("loaded"),validatedCookies(o.value(QStringLiteral("cookies")).toArray())};}catch(...){wipe(plain);remove(overridePath);return {QStringLiteral("invalid"),{}};}
 }
private:
 friend class BookingService;
 enum {MaxPlain=262144,MaxCipher=524288};
 static void require(bool ok){if(!ok)throw std::runtime_error("session_store_unavailable");}
 static QString chosenPath(const QString &p){return p.isEmpty()?defaultPath():p;}
 static void wipe(QByteArray &b){if(!b.isEmpty()){
#ifdef Q_OS_WIN
  SecureZeroMemory(b.data(),SIZE_T(b.size()));
#else
  volatile char *p=b.data();for(int i=0;i<b.size();++i)p[i]=0;
#endif
 }b.clear();}
 static bool safeFilePath(const QString &p){const QFileInfo f(p);if(f.isSymLink())return false;
#ifdef Q_OS_WIN
  const auto w=QDir::toNativeSeparators(f.absoluteFilePath());const auto attr=GetFileAttributesW(reinterpret_cast<LPCWSTR>(w.utf16()));if(attr!=INVALID_FILE_ATTRIBUTES&&(attr&FILE_ATTRIBUTE_REPARSE_POINT))return false;QDir d=f.absoluteDir();for(;;){const auto name=QDir::toNativeSeparators(d.absolutePath());const auto a=GetFileAttributesW(reinterpret_cast<LPCWSTR>(name.utf16()));if(a!=INVALID_FILE_ATTRIBUTES&&(a&FILE_ATTRIBUTE_REPARSE_POINT))return false;if(d.isRoot())break;if(!d.cdUp())return false;}
#endif
#ifdef Q_OS_MACOS
  // A missing file is expected on the save path. Only reject an existing
  // symlink, or a file that is group/world writable. Ancestor directories are
  // not inspected: macOS temp roots (/var/folders/.../T) are intentionally
  // world-writable with the sticky bit, which is safe.
  if(!f.exists())return true;
  struct stat st{};const QByteArray fp=QFile::encodeName(f.absoluteFilePath());
  if(lstat(fp.constData(),&st)!=0)return false;
  if(S_ISLNK(st.st_mode))return false;
  return (st.st_mode&(S_IWGRP|S_IWOTH))==0;
#endif
  return true;}
 static QString currentOwner(){
#ifdef Q_OS_WIN
  QLibrary a(QStringLiteral("advapi32"));const auto open=reinterpret_cast<BOOL(WINAPI*)(HANDLE,DWORD,PHANDLE)>(a.resolve("OpenProcessToken"));const auto info=reinterpret_cast<BOOL(WINAPI*)(HANDLE,TOKEN_INFORMATION_CLASS,LPVOID,DWORD,PDWORD)>(a.resolve("GetTokenInformation"));const auto convert=reinterpret_cast<BOOL(WINAPI*)(PSID,LPWSTR*)>(a.resolve("ConvertSidToStringSidW"));require(open&&info&&convert);HANDLE token=nullptr;require(open(GetCurrentProcess(),TOKEN_QUERY,&token));DWORD size=0;info(token,TokenUser,nullptr,0,&size);QByteArray b(int(size),0);const bool ok=size>0&&info(token,TokenUser,b.data(),size,&size);CloseHandle(token);require(ok);LPWSTR raw=nullptr;require(convert(reinterpret_cast<TOKEN_USER*>(b.data())->User.Sid,&raw));const auto result=QString::fromWCharArray(raw);LocalFree(raw);return result;
#elif defined(Q_OS_MACOS)
  const uid_t uid=getuid();require(uid!=(uid_t)-1);return QStringLiteral("mac-uid-%1").arg(quint64(uid));
#else
  return {};
#endif
 }
 static bool ensureFileOwner(const QString &p,const QString &owner){
#ifdef Q_OS_WIN
  if(ownedFile(p,owner))return true;
  QLibrary a(QStringLiteral("advapi32"));const auto convert=reinterpret_cast<BOOL(WINAPI*)(LPCWSTR,PSID*)>(a.resolve("ConvertStringSidToSidW"));const auto set=reinterpret_cast<DWORD(WINAPI*)(LPWSTR,SE_OBJECT_TYPE,SECURITY_INFORMATION,PSID,PSID,PACL,PACL)>(a.resolve("SetNamedSecurityInfoW"));if(!convert||!set)return false;PSID sid=nullptr;if(!convert(reinterpret_cast<LPCWSTR>(owner.utf16()),&sid))return false;auto name=QDir::toNativeSeparators(QFileInfo(p).absoluteFilePath());const auto status=set(reinterpret_cast<LPWSTR>(name.data()),SE_FILE_OBJECT,OWNER_SECURITY_INFORMATION,sid,nullptr,nullptr,nullptr);LocalFree(sid);return status==ERROR_SUCCESS&&ownedFile(p,owner);
#elif defined(Q_OS_MACOS)
  Q_UNUSED(owner);QFile::Permissions perm=QFileDevice::ReadOwner|QFileDevice::WriteOwner;QFile::setPermissions(p,perm);return ownedFile(p,currentOwner());
#else
  Q_UNUSED(p);Q_UNUSED(owner);return false;
#endif
 }
 static bool ownedFile(const QString &p,const QString &owner){
#ifdef Q_OS_WIN
  QLibrary a(QStringLiteral("advapi32"));const auto get=reinterpret_cast<DWORD(WINAPI*)(LPWSTR,SE_OBJECT_TYPE,SECURITY_INFORMATION,PSID*,PSID*,PACL*,PACL*,PSECURITY_DESCRIPTOR*)>(a.resolve("GetNamedSecurityInfoW"));const auto convert=reinterpret_cast<BOOL(WINAPI*)(PSID,LPWSTR*)>(a.resolve("ConvertSidToStringSidW"));if(!get||!convert)return false;auto name=QDir::toNativeSeparators(QFileInfo(p).absoluteFilePath());PSID sid=nullptr;PSECURITY_DESCRIPTOR descriptor=nullptr;if(get(reinterpret_cast<LPWSTR>(name.data()),SE_FILE_OBJECT,OWNER_SECURITY_INFORMATION,&sid,nullptr,nullptr,nullptr,&descriptor)!=ERROR_SUCCESS)return false;LPWSTR raw=nullptr;const bool ok=sid&&convert(sid,&raw);const bool same=ok&&QString::fromWCharArray(raw)==owner;if(raw)LocalFree(raw);if(descriptor)LocalFree(descriptor);return same;
#elif defined(Q_OS_MACOS)
  if(owner!=currentOwner())return false;struct stat st{};if(lstat(QFile::encodeName(QFileInfo(p).absoluteFilePath()).constData(),&st)!=0)return false;if(!S_ISREG(st.st_mode))return false;const QString expected=QStringLiteral("mac-uid-%1").arg(quint64(st.st_uid));if(expected!=owner)return false;return (st.st_mode&(S_IRUSR|S_IWUSR))==(S_IRUSR|S_IWUSR)&&(st.st_mode&(S_IRWXG|S_IRWXO))==0;
#else
  Q_UNUSED(p);Q_UNUSED(owner);return false;
#endif
 }
#ifdef Q_OS_MACOS
 // Fetch (or create) the 32-byte master key in the login Keychain. Access is
 // scoped to the current user / this device and unlocked-only; no plaintext
 // cookie is ever written to the Keychain, only the wrapping key.
 static QByteArray macMasterKey(){
  const QByteArray service="HospitalBooking.OfficialSession.mac.v1";
  const QByteArray account=QByteArray::number(quint64(getuid()));
  auto makeString=[](const QByteArray &b)->CFStringRef{return CFStringCreateWithBytes(kCFAllocatorDefault,reinterpret_cast<const UInt8*>(b.constData()),b.size(),kCFStringEncodingUTF8,false);};
  CFStringRef cfService=makeString(service),cfAccount=makeString(account);
  if(!cfService||!cfAccount){if(cfService)CFRelease(cfService);if(cfAccount)CFRelease(cfAccount);throw std::runtime_error("session_store_unavailable");}
  CFMutableDictionaryRef query=CFDictionaryCreateMutable(kCFAllocatorDefault,0,&kCFTypeDictionaryKeyCallBacks,&kCFTypeDictionaryValueCallBacks);
  if(!query){CFRelease(cfService);CFRelease(cfAccount);throw std::runtime_error("session_store_unavailable");}
  CFDictionarySetValue(query,kSecClass,kSecClassGenericPassword);
  CFDictionarySetValue(query,kSecAttrService,cfService);
  CFDictionarySetValue(query,kSecAttrAccount,cfAccount);
  CFDictionarySetValue(query,kSecReturnData,kCFBooleanTrue);
  CFDictionarySetValue(query,kSecMatchLimit,kSecMatchLimitOne);
  CFTypeRef item=nullptr;OSStatus status=SecItemCopyMatching(query,&item);
  QByteArray key;
  if(status==errSecSuccess&&item){
   if(CFGetTypeID(item)==CFDataGetTypeID()){CFDataRef data=static_cast<CFDataRef>(item);key=QByteArray(reinterpret_cast<const char*>(CFDataGetBytePtr(data)),int(CFDataGetLength(data)));}
   CFRelease(item);
  }else if(status==errSecItemNotFound){
   QByteArray fresh(32,Qt::Uninitialized);require(SecRandomCopyBytes(kSecRandomDefault,size_t(fresh.size()),fresh.data())==errSecSuccess);
   CFDataRef value=CFDataCreate(kCFAllocatorDefault,reinterpret_cast<const UInt8*>(fresh.constData()),fresh.size());
   CFMutableDictionaryRef add=CFDictionaryCreateMutable(kCFAllocatorDefault,0,&kCFTypeDictionaryKeyCallBacks,&kCFTypeDictionaryValueCallBacks);
   if(value&&add){
    CFDictionarySetValue(add,kSecClass,kSecClassGenericPassword);
    CFDictionarySetValue(add,kSecAttrService,cfService);
    CFDictionarySetValue(add,kSecAttrAccount,cfAccount);
    CFDictionarySetValue(add,kSecValueData,value);
    CFDictionarySetValue(add,kSecAttrAccessible,kSecAttrAccessibleWhenUnlockedThisDeviceOnly);
    const OSStatus added=SecItemAdd(add,nullptr);
    if(added==errSecSuccess||added==errSecDuplicateItem)key=fresh;
    wipe(fresh);
   }
   if(add)CFRelease(add);if(value)CFRelease(value);
  }
  CFRelease(query);CFRelease(cfService);CFRelease(cfAccount);
  if(key.isEmpty()){// Race or transient failure: re-read an existing item.
   CFStringRef s=makeString(service),a=makeString(account);CFMutableDictionaryRef q=CFDictionaryCreateMutable(kCFAllocatorDefault,0,&kCFTypeDictionaryKeyCallBacks,&kCFTypeDictionaryValueCallBacks);
   if(s&&a&&q){CFDictionarySetValue(q,kSecClass,kSecClassGenericPassword);CFDictionarySetValue(q,kSecAttrService,s);CFDictionarySetValue(q,kSecAttrAccount,a);CFDictionarySetValue(q,kSecReturnData,kCFBooleanTrue);CFDictionarySetValue(q,kSecMatchLimit,kSecMatchLimitOne);CFTypeRef it=nullptr;if(SecItemCopyMatching(q,&it)==errSecSuccess&&it){if(CFGetTypeID(it)==CFDataGetTypeID()){CFDataRef d=static_cast<CFDataRef>(it);key=QByteArray(reinterpret_cast<const char*>(CFDataGetBytePtr(d)),int(CFDataGetLength(d)));}CFRelease(it);}}
   if(q)CFRelease(q);if(s)CFRelease(s);if(a)CFRelease(a);
  }
  require(key.size()==32);return key;
 }
 static void macHmac(const QByteArray &key,const QByteArray &a,const QByteArray &b,QByteArray &out){
  out.resize(CC_SHA256_DIGEST_LENGTH);CCHmacContext ctx;CCHmacInit(&ctx,kCCHmacAlgSHA256,key.constData(),key.size());CCHmacUpdate(&ctx,a.constData(),a.size());CCHmacUpdate(&ctx,b.constData(),b.size());CCHmacFinal(&ctx,out.data());
 }
 static bool macEqual(const QByteArray &a,const QByteArray &b){if(a.size()!=b.size())return false;unsigned char diff=0;for(int i=0;i<a.size();++i)diff|=static_cast<unsigned char>(a.at(i))^static_cast<unsigned char>(b.at(i));return diff==0;}
#endif
 static QByteArray protect(const QByteArray &input,bool decrypt){
#ifdef Q_OS_WIN
  require(!input.isEmpty()&&input.size()<=MaxCipher);QLibrary c(QStringLiteral("crypt32"));DATA_BLOB in{DWORD(input.size()),reinterpret_cast<BYTE*>(const_cast<char*>(input.constData()))},out{};QByteArray entropy("HospitalBooking.OfficialSession.CurrentUser.v1");DATA_BLOB extra{DWORD(entropy.size()),reinterpret_cast<BYTE*>(entropy.data())};BOOL ok=FALSE;LPWSTR description=nullptr;if(decrypt){const auto fn=reinterpret_cast<BOOL(WINAPI*)(DATA_BLOB*,LPWSTR*,DATA_BLOB*,PVOID,CRYPTPROTECT_PROMPTSTRUCT*,DWORD,DATA_BLOB*)>(c.resolve("CryptUnprotectData"));require(fn);ok=fn(&in,&description,&extra,nullptr,nullptr,CRYPTPROTECT_UI_FORBIDDEN,&out);}else{const auto fn=reinterpret_cast<BOOL(WINAPI*)(DATA_BLOB*,LPCWSTR,DATA_BLOB*,PVOID,CRYPTPROTECT_PROMPTSTRUCT*,DWORD,DATA_BLOB*)>(c.resolve("CryptProtectData"));require(fn);ok=fn(&in,L"HospitalBooking official session",&extra,nullptr,nullptr,CRYPTPROTECT_UI_FORBIDDEN,&out);}if(description)LocalFree(description);if(!ok){if(out.pbData)LocalFree(out.pbData);throw std::runtime_error("session_store_unavailable");}QByteArray result(reinterpret_cast<const char*>(out.pbData),int(out.cbData));if(out.pbData){SecureZeroMemory(out.pbData,out.cbData);LocalFree(out.pbData);}return result;
#elif defined(Q_OS_MACOS)
  require(!input.isEmpty()&&input.size()<=MaxCipher);
  const QByteArray master=macMasterKey();require(master.size()==32);
  const QByteArray encKey=master;
  const QByteArray macKey=QCryptographicHash::hash(master+QByteArray("official-session-mac-v1"),QCryptographicHash::Sha256);
  if(!decrypt){
   QByteArray iv(16,Qt::Uninitialized);require(SecRandomCopyBytes(kSecRandomDefault,size_t(iv.size()),iv.data())==errSecSuccess);
   size_t moved=0,final=0;
   CCCryptorRef cryptor=nullptr;require(CCCryptorCreate(kCCEncrypt,kCCAlgorithmAES,kCCOptionPKCS7Padding,encKey.constData(),encKey.size(),iv.constData(),&cryptor)==kCCSuccess&&cryptor);
   QByteArray ct(int(input.size())+16,Qt::Uninitialized);
   const CCCryptorStatus a=CCCryptorUpdate(cryptor,input.constData(),input.size(),ct.data(),size_t(ct.size()),&moved);
   const CCCryptorStatus b=CCCryptorFinal(cryptor,ct.data()+moved,size_t(ct.size())-moved,&final);
   CCCryptorRelease(cryptor);require(a==kCCSuccess&&b==kCCSuccess);ct.resize(int(moved+final));
   QByteArray tag;macHmac(macKey,iv,ct,tag);
   QByteArray out;out.reserve(iv.size()+ct.size()+tag.size());out.append(iv);out.append(ct);out.append(tag);wipe(iv);wipe(ct);wipe(tag);return out;
  }
  require(input.size()>16+CC_SHA256_DIGEST_LENGTH);
  const QByteArray iv=input.left(16),tag=input.right(CC_SHA256_DIGEST_LENGTH),ct=input.mid(16,input.size()-16-CC_SHA256_DIGEST_LENGTH);
  QByteArray expected;macHmac(macKey,iv,ct,expected);if(!macEqual(expected,tag))throw std::runtime_error("session_store_unavailable");
  size_t moved=0,final=0;CCCryptorRef cryptor=nullptr;require(CCCryptorCreate(kCCDecrypt,kCCAlgorithmAES,kCCOptionPKCS7Padding,encKey.constData(),encKey.size(),iv.constData(),&cryptor)==kCCSuccess&&cryptor);
  QByteArray plain(int(ct.size())+16,Qt::Uninitialized);
  const CCCryptorStatus a=CCCryptorUpdate(cryptor,ct.constData(),ct.size(),plain.data(),size_t(plain.size()),&moved);
  const CCCryptorStatus b=CCCryptorFinal(cryptor,plain.data()+moved,size_t(plain.size())-moved,&final);
  CCCryptorRelease(cryptor);if(a!=kCCSuccess||b!=kCCSuccess){wipe(plain);throw std::runtime_error("session_store_unavailable");}plain.resize(int(moved+final));return plain;
#else
  Q_UNUSED(input);Q_UNUSED(decrypt);throw std::runtime_error("session_store_unavailable");
#endif
 }
};
}
