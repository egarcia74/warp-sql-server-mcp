-- =============================================================================
-- SQL Server Test Database Initialization Script
-- Creates test databases and sample data for MCP Server validation
-- Fixed version - resolves schema conflicts and missing dependencies
-- Enhanced with error handling and logging for troubleshooting
-- =============================================================================

RAISERROR('[INIT] Starting database initialization script...', 0, 1) WITH NOWAIT;
DECLARE @StartTime VARCHAR(25) = CONVERT(varchar, GETDATE(), 120);
DECLARE @StartMsg VARCHAR(100) = '[TIME] Script started at: ' + @StartTime;
RAISERROR(@StartMsg, 0, 1) WITH NOWAIT;
GO

-- Enable error handling and logging
SET NOCOUNT ON;
SET ANSI_WARNINGS OFF; -- Suppress truncation warnings for cleaner output
GO

-- Create test databases (with proper error handling)
RAISERROR('[DB] Creating test databases...', 0, 1) WITH NOWAIT;

-- WarpMcpTest Database
IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = 'WarpMcpTest')
BEGIN
    RAISERROR('   [+] Creating database: WarpMcpTest', 0, 1) WITH NOWAIT;
    CREATE DATABASE WarpMcpTest;
    RAISERROR('   [OK] Database WarpMcpTest created successfully', 0, 1) WITH NOWAIT;
END
ELSE
BEGIN
    RAISERROR('   [SKIP] Database WarpMcpTest already exists - skipping creation', 0, 1) WITH NOWAIT;
END
GO

-- Phase1ReadOnly Database
IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = 'Phase1ReadOnly')
BEGIN
    RAISERROR('   [+] Creating database: Phase1ReadOnly', 0, 1) WITH NOWAIT;
    CREATE DATABASE Phase1ReadOnly;
    RAISERROR('   [OK] Database Phase1ReadOnly created successfully', 0, 1) WITH NOWAIT;
END
ELSE
BEGIN
    RAISERROR('   [SKIP] Database Phase1ReadOnly already exists - skipping creation', 0, 1) WITH NOWAIT;
END
GO

-- Phase2DML Database
IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = 'Phase2DML')
BEGIN
    RAISERROR('   [+] Creating database: Phase2DML', 0, 1) WITH NOWAIT;
    CREATE DATABASE Phase2DML;
    RAISERROR('   [OK] Database Phase2DML created successfully', 0, 1) WITH NOWAIT;
END
ELSE
BEGIN
    RAISERROR('   [SKIP] Database Phase2DML already exists - skipping creation', 0, 1) WITH NOWAIT;
END
GO

-- Phase3DDL Database
IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = 'Phase3DDL')
BEGIN
    RAISERROR('   [+] Creating database: Phase3DDL', 0, 1) WITH NOWAIT;
    CREATE DATABASE Phase3DDL;
    RAISERROR('   [OK] Database Phase3DDL created successfully', 0, 1) WITH NOWAIT;
END
ELSE
BEGIN
    RAISERROR('   [SKIP] Database Phase3DDL already exists - skipping creation', 0, 1) WITH NOWAIT;
END
GO

-- ProtocolTest Database
IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = 'ProtocolTest')
BEGIN
    RAISERROR('   [+] Creating database: ProtocolTest', 0, 1) WITH NOWAIT;
    CREATE DATABASE ProtocolTest;
    RAISERROR('   [OK] Database ProtocolTest created successfully', 0, 1) WITH NOWAIT;
END
ELSE
BEGIN
    RAISERROR('   [SKIP] Database ProtocolTest already exists - skipping creation', 0, 1) WITH NOWAIT;
END
GO

RAISERROR('[DB] All test databases verified/created successfully', 0, 1) WITH NOWAIT;
RAISERROR('', 0, 1) WITH NOWAIT;

-- Use main test database
RAISERROR('[DB] Switching to main test database: WarpMcpTest', 0, 1) WITH NOWAIT;
USE WarpMcpTest;
RAISERROR('[OK] Now using database: WarpMcpTest', 0, 1) WITH NOWAIT;
GO

-- =============================================================================
-- 1. CREATE CONSISTENT TEST TABLES (Northwind-style schema)
-- =============================================================================

RAISERROR('[SCHEMA] Creating database schema (tables with relationships)...', 0, 1) WITH NOWAIT;

-- Drop existing tables if they exist (in correct order to handle foreign keys)
RAISERROR('[CLEAN] Cleaning up existing tables (if any)...', 0, 1) WITH NOWAIT;
BEGIN TRY
    IF OBJECT_ID('[Order Details]', 'U') IS NOT NULL 
    BEGIN
        DROP TABLE [Order Details];
        RAISERROR('   [OK] Dropped existing table: Order Details', 0, 1) WITH NOWAIT;
    END
    
    IF OBJECT_ID('Orders', 'U') IS NOT NULL 
    BEGIN
        DROP TABLE Orders;
        RAISERROR('   [OK] Dropped existing table: Orders', 0, 1) WITH NOWAIT;
    END
    
    IF OBJECT_ID('Products', 'U') IS NOT NULL 
    BEGIN
        DROP TABLE Products;
        RAISERROR('   [OK] Dropped existing table: Products', 0, 1) WITH NOWAIT;
    END
    
    IF OBJECT_ID('Customers', 'U') IS NOT NULL 
    BEGIN
        DROP TABLE Customers;
        RAISERROR('   [OK] Dropped existing table: Customers', 0, 1) WITH NOWAIT;
    END
    
    IF OBJECT_ID('Suppliers', 'U') IS NOT NULL 
    BEGIN
        DROP TABLE Suppliers;
        RAISERROR('   [OK] Dropped existing table: Suppliers', 0, 1) WITH NOWAIT;
    END
    
    IF OBJECT_ID('Categories', 'U') IS NOT NULL 
    BEGIN
        DROP TABLE Categories;
        RAISERROR('   [OK] Dropped existing table: Categories', 0, 1) WITH NOWAIT;
    END
    
    RAISERROR('[CLEAN] Table cleanup completed', 0, 1) WITH NOWAIT;
END TRY
BEGIN CATCH
    DECLARE @ErrorMsg NVARCHAR(255) = '❌ Error during table cleanup: ' + ERROR_MESSAGE();
    RAISERROR(@ErrorMsg, 16, 1) WITH NOWAIT;
    THROW;
END CATCH
GO

-- Categories table
RAISERROR('[TABLE] Creating table: Categories', 0, 1) WITH NOWAIT;
BEGIN TRY
    CREATE TABLE Categories (
        CategoryID int IDENTITY(1,1) PRIMARY KEY,
        CategoryName nvarchar(15) NOT NULL,
        Description ntext
    );
    RAISERROR('   [OK] Table Categories created successfully', 0, 1) WITH NOWAIT;
END TRY
BEGIN CATCH
    DECLARE @ErrorMsg1 NVARCHAR(255) = '   ❌ Error creating Categories table: ' + ERROR_MESSAGE();
    RAISERROR(@ErrorMsg1, 16, 1) WITH NOWAIT;
    THROW;
END CATCH

-- Suppliers table
RAISERROR('[TABLE] Creating table: Suppliers', 0, 1) WITH NOWAIT;
BEGIN TRY
    CREATE TABLE Suppliers (
        SupplierID int IDENTITY(1,1) PRIMARY KEY,
        CompanyName nvarchar(40) NOT NULL,
        ContactName nvarchar(30),
        ContactTitle nvarchar(30),
        Address nvarchar(60),
        City nvarchar(15),
        Region nvarchar(15),
        PostalCode nvarchar(10),
        Country nvarchar(15),
        Phone nvarchar(24),
        Fax nvarchar(24),
        HomePage ntext
    );
    RAISERROR('   [OK] Table Suppliers created successfully', 0, 1) WITH NOWAIT;
END TRY
BEGIN CATCH
    DECLARE @ErrorMsg2 NVARCHAR(255) = '   ❌ Error creating Suppliers table: ' + ERROR_MESSAGE();
    RAISERROR(@ErrorMsg2, 16, 1) WITH NOWAIT;
    THROW;
END CATCH

-- Products table (with all required columns)
PRINT '[TABLE] Creating table: Products (with foreign key relationships)';
BEGIN TRY
    CREATE TABLE Products (
        ProductID int IDENTITY(1,1) PRIMARY KEY,
        ProductName nvarchar(40) NOT NULL,
        SupplierID int,
        CategoryID int,
        QuantityPerUnit nvarchar(20),
        UnitPrice money DEFAULT 0,
        UnitsInStock smallint DEFAULT 0,
        UnitsOnOrder smallint DEFAULT 0,
        ReorderLevel smallint DEFAULT 0,
        Discontinued bit DEFAULT 0,
        FOREIGN KEY (CategoryID) REFERENCES Categories(CategoryID),
        FOREIGN KEY (SupplierID) REFERENCES Suppliers(SupplierID)
    );
    PRINT '   [OK] Table Products created successfully with foreign key constraints';
END TRY
BEGIN CATCH
    PRINT '   ❌ Error creating Products table: ' + ERROR_MESSAGE();
    THROW;
END CATCH

-- Customers table
PRINT '[TABLE] Creating table: Customers';
BEGIN TRY
    CREATE TABLE Customers (
        CustomerID nchar(5) PRIMARY KEY,
        CompanyName nvarchar(40) NOT NULL,
        ContactName nvarchar(30),
        ContactTitle nvarchar(30),
        Address nvarchar(60),
        City nvarchar(15),
        Region nvarchar(15),
        PostalCode nvarchar(10),
        Country nvarchar(15),
        Phone nvarchar(24),
        Fax nvarchar(24)
    );
    PRINT '   [OK] Table Customers created successfully';
END TRY
BEGIN CATCH
    PRINT '   ❌ Error creating Customers table: ' + ERROR_MESSAGE();
    THROW;
END CATCH

-- Orders table
PRINT '[TABLE] Creating table: Orders (with foreign key relationships)';
BEGIN TRY
    CREATE TABLE Orders (
        OrderID int IDENTITY(1,1) PRIMARY KEY,
        CustomerID nchar(5),
        EmployeeID int,
        OrderDate datetime,
        RequiredDate datetime,
        ShippedDate datetime,
        ShipVia int,
        Freight money DEFAULT 0,
        ShipName nvarchar(40),
        ShipAddress nvarchar(60),
        ShipCity nvarchar(15),
        ShipRegion nvarchar(15),
        ShipPostalCode nvarchar(10),
        ShipCountry nvarchar(15),
        FOREIGN KEY (CustomerID) REFERENCES Customers(CustomerID)
    );
    PRINT '   [OK] Table Orders created successfully with foreign key constraints';
END TRY
BEGIN CATCH
    PRINT '   ❌ Error creating Orders table: ' + ERROR_MESSAGE();
    THROW;
END CATCH

-- OrderDetails table
PRINT '[TABLE] Creating table: Order Details (junction table with composite key)';
BEGIN TRY
    CREATE TABLE [Order Details] (
        OrderID int NOT NULL,
        ProductID int NOT NULL,
        UnitPrice money DEFAULT 0,
        Quantity smallint DEFAULT 1,
        Discount real DEFAULT 0,
        PRIMARY KEY (OrderID, ProductID),
        FOREIGN KEY (OrderID) REFERENCES Orders(OrderID),
        FOREIGN KEY (ProductID) REFERENCES Products(ProductID)
    );
    PRINT '   [OK] Table Order Details created successfully with composite primary key and foreign key constraints';
END TRY
BEGIN CATCH
    PRINT '   ❌ Error creating Order Details table: ' + ERROR_MESSAGE();
    THROW;
END CATCH

PRINT '[SCHEMA] All database tables created successfully';
PRINT '';
GO

-- =============================================================================
-- 2. INSERT SAMPLE DATA
-- =============================================================================

RAISERROR('[INDEX] Populating tables with sample data...', 0, 1) WITH NOWAIT;

-- Insert Categories
RAISERROR('[DATA] Inserting Categories data...', 0, 1) WITH NOWAIT;
BEGIN TRY
    INSERT INTO Categories (CategoryName, Description) VALUES
    ('Beverages', 'Soft drinks, coffees, teas, beers, and ales'),
    ('Condiments', 'Sweet and savory sauces, relishes, spreads, and seasonings'),
    ('Dairy Products', 'Cheeses'),
    ('Grains/Cereals', 'Breads, crackers, pasta, and cereal'),
    ('Meat/Poultry', 'Prepared meats'),
    ('Produce', 'Dried fruit and bean curd'),
    ('Seafood', 'Seaweed and fish'),
    ('Confections', 'Desserts, candies, and sweet breads');
    
    DECLARE @CategoryCount int = @@ROWCOUNT;
    DECLARE @CatMsg VARCHAR(100) = '   [OK] Inserted ' + CAST(@CategoryCount AS varchar) + ' categories';
    RAISERROR(@CatMsg, 0, 1) WITH NOWAIT;
END TRY
BEGIN CATCH
    DECLARE @ErrorMsg3 NVARCHAR(255) = '   ❌ Error inserting Categories data: ' + ERROR_MESSAGE();
    RAISERROR(@ErrorMsg3, 16, 1) WITH NOWAIT;
    THROW;
END CATCH

-- Insert Suppliers
RAISERROR('[DATA] Inserting Suppliers data...', 0, 1) WITH NOWAIT;
BEGIN TRY
    INSERT INTO Suppliers (CompanyName, ContactName, City, Country, Phone) VALUES
    ('Exotic Liquids', 'Charlotte Cooper', 'London', 'UK', '(171) 555-2222'),
    ('New Orleans Cajun Delights', 'Shelley Burke', 'New Orleans', 'USA', '(100) 555-4822'),
    ('Grandma Kelly''s Homestead', 'Regina Murphy', 'Ann Arbor', 'USA', '(313) 555-5735'),
    ('Tokyo Traders', 'Yoshi Nagase', 'Tokyo', 'Japan', '(03) 3555-5011'),
    ('Cooperativa de Quesos ''Las Cabras''', 'Antonio del Valle Saavedra', 'Oviedo', 'Spain', '(98) 598 76 54');
    
    DECLARE @SupplierCount int = @@ROWCOUNT;
    DECLARE @SupMsg VARCHAR(100) = '   [OK] Inserted ' + CAST(@SupplierCount AS varchar) + ' suppliers';
    RAISERROR(@SupMsg, 0, 1) WITH NOWAIT;
END TRY
BEGIN CATCH
    DECLARE @ErrorMsg4 NVARCHAR(255) = '   ❌ Error inserting Suppliers data: ' + ERROR_MESSAGE();
    RAISERROR(@ErrorMsg4, 16, 1) WITH NOWAIT;
    THROW;
END CATCH

-- Insert Products
RAISERROR('[DATA] Inserting Products data...', 0, 1) WITH NOWAIT;
BEGIN TRY
    INSERT INTO Products (ProductName, SupplierID, CategoryID, QuantityPerUnit, UnitPrice, UnitsInStock) VALUES
    ('Chai', 1, 1, '10 boxes x 20 bags', 18.00, 39),
    ('Chang', 1, 1, '24 - 12 oz bottles', 19.00, 17),
    ('Aniseed Syrup', 1, 2, '12 - 550 ml bottles', 10.00, 13),
    ('Chef Anton''s Cajun Seasoning', 2, 2, '48 - 6 oz jars', 22.00, 53),
    ('Chef Anton''s Gumbo Mix', 2, 2, '36 boxes', 21.35, 0),
    ('Grandma''s Boysenberry Spread', 3, 2, '12 - 8 oz jars', 25.00, 120),
    ('Uncle Bob''s Organic Dried Pears', 3, 7, '12 - 1 lb pkgs.', 30.00, 15),
    ('Northwoods Cranberry Sauce', 3, 2, '12 - 12 oz jars', 40.00, 6),
    ('Mishi Kobe Niku', 4, 6, '18 - 500 g pkgs.', 97.00, 29),
    ('Ikura', 4, 8, '12 - 200 ml jars', 31.00, 31),
    ('Queso Cabrales', 5, 4, '1 kg pkg.', 21.00, 22),
    ('Queso Manchego La Pastora', 5, 4, '10 - 500 g pkgs.', 38.00, 86);
    
    DECLARE @ProductCount int = @@ROWCOUNT;
    DECLARE @ProdMsg VARCHAR(100) = '   [OK] Inserted ' + CAST(@ProductCount AS varchar) + ' products';
    RAISERROR(@ProdMsg, 0, 1) WITH NOWAIT;
END TRY
BEGIN CATCH
    DECLARE @ErrorMsg5 NVARCHAR(255) = '   ❌ Error inserting Products data: ' + ERROR_MESSAGE();
    RAISERROR(@ErrorMsg5, 16, 1) WITH NOWAIT;
    THROW;
END CATCH

-- Insert Customers
RAISERROR('[DATA] Inserting Customers data...', 0, 1) WITH NOWAIT;
BEGIN TRY
    INSERT INTO Customers (CustomerID, CompanyName, ContactName, City, Country) VALUES
    ('ALFKI', 'Alfreds Futterkiste', 'Maria Anders', 'Berlin', 'Germany'),
    ('ANATR', 'Ana Trujillo Emparedados y helados', 'Ana Trujillo', 'México D.F.', 'Mexico'),
    ('ANTON', 'Antonio Moreno Taquería', 'Antonio Moreno', 'México D.F.', 'Mexico'),
    ('AROUT', 'Around the Horn', 'Thomas Hardy', 'London', 'UK'),
    ('BERGS', 'Berglunds snabbköp', 'Christina Berglund', 'Luleå', 'Sweden');
    
    DECLARE @CustomerCount int = @@ROWCOUNT;
    DECLARE @CustMsg VARCHAR(100) = '   [OK] Inserted ' + CAST(@CustomerCount AS varchar) + ' customers';
    RAISERROR(@CustMsg, 0, 1) WITH NOWAIT;
END TRY
BEGIN CATCH
    DECLARE @ErrorMsg6 NVARCHAR(255) = '   ❌ Error inserting Customers data: ' + ERROR_MESSAGE();
    RAISERROR(@ErrorMsg6, 16, 1) WITH NOWAIT;
    THROW;
END CATCH

-- Insert Orders
RAISERROR('[DATA] Inserting Orders data...', 0, 1) WITH NOWAIT;
BEGIN TRY
    INSERT INTO Orders (CustomerID, OrderDate, RequiredDate, ShippedDate, Freight) VALUES
    ('ALFKI', '1996-07-04', '1996-08-01', '1996-07-16', 32.38),
    ('ANATR', '1996-07-05', '1996-08-16', '1996-07-10', 11.61),
    ('ANTON', '1996-07-08', '1996-08-05', '1996-07-12', 65.83),
    ('AROUT', '1996-07-08', '1996-08-05', '1996-07-15', 41.34),
    ('BERGS', '1996-07-09', '1996-08-06', '1996-07-11', 51.30);
    
    DECLARE @OrderCount int = @@ROWCOUNT;
    DECLARE @OrderMsg VARCHAR(100) = '   [OK] Inserted ' + CAST(@OrderCount AS varchar) + ' orders';
    RAISERROR(@OrderMsg, 0, 1) WITH NOWAIT;
END TRY
BEGIN CATCH
    DECLARE @ErrorMsg7 NVARCHAR(255) = '   ❌ Error inserting Orders data: ' + ERROR_MESSAGE();
    RAISERROR(@ErrorMsg7, 16, 1) WITH NOWAIT;
    THROW;
END CATCH

-- Insert Order Details
RAISERROR('[DATA] Inserting Order Details data...', 0, 1) WITH NOWAIT;
BEGIN TRY
    INSERT INTO [Order Details] (OrderID, ProductID, UnitPrice, Quantity, Discount) VALUES
    (1, 1, 14.00, 12, 0),
    (1, 2, 18.60, 10, 0),
    (2, 3, 8.00, 5, 0),
    (2, 4, 17.60, 9, 0),
    (3, 5, 17.00, 40, 0.05),
    (4, 6, 20.00, 10, 0.05),
    (5, 7, 24.00, 35, 0.05);
    
    DECLARE @OrderDetailCount int = @@ROWCOUNT;
    DECLARE @ODMsg VARCHAR(100) = '   [OK] Inserted ' + CAST(@OrderDetailCount AS varchar) + ' order details';
    RAISERROR(@ODMsg, 0, 1) WITH NOWAIT;
END TRY
BEGIN CATCH
    DECLARE @ErrorMsg8 NVARCHAR(255) = '   ❌ Error inserting Order Details data: ' + ERROR_MESSAGE();
    RAISERROR(@ErrorMsg8, 16, 1) WITH NOWAIT;
    THROW;
END CATCH

RAISERROR('[INDEX] All sample data inserted successfully', 0, 1) WITH NOWAIT;
PRINT '';
GO

-- =============================================================================
-- 3. CREATE INDEXES FOR PERFORMANCE
-- =============================================================================

RAISERROR('[INIT] Creating performance indexes...', 0, 1) WITH NOWAIT;

-- Index on Products.CategoryID for foreign key performance
RAISERROR('[INDEX] Creating index: IX_Products_CategoryID', 0, 1) WITH NOWAIT;
BEGIN TRY
    CREATE INDEX IX_Products_CategoryID ON Products(CategoryID);
    RAISERROR('   [OK] Index IX_Products_CategoryID created successfully', 0, 1) WITH NOWAIT;
END TRY
BEGIN CATCH
    DECLARE @ErrorMsg9 NVARCHAR(255) = '   ❌ Error creating IX_Products_CategoryID index: ' + ERROR_MESSAGE();
    RAISERROR(@ErrorMsg9, 16, 1) WITH NOWAIT;
    THROW;
END CATCH

-- Index on Products.SupplierID for foreign key performance  
RAISERROR('[INDEX] Creating index: IX_Products_SupplierID', 0, 1) WITH NOWAIT;
BEGIN TRY
    CREATE INDEX IX_Products_SupplierID ON Products(SupplierID);
    RAISERROR('   [OK] Index IX_Products_SupplierID created successfully', 0, 1) WITH NOWAIT;
END TRY
BEGIN CATCH
    DECLARE @ErrorMsg10 NVARCHAR(255) = '   ❌ Error creating IX_Products_SupplierID index: ' + ERROR_MESSAGE();
    RAISERROR(@ErrorMsg10, 16, 1) WITH NOWAIT;
    THROW;
END CATCH

-- Index on Orders.CustomerID for foreign key performance
RAISERROR('[INDEX] Creating index: IX_Orders_CustomerID', 0, 1) WITH NOWAIT;
BEGIN TRY
    CREATE INDEX IX_Orders_CustomerID ON Orders(CustomerID);
    RAISERROR('   [OK] Index IX_Orders_CustomerID created successfully', 0, 1) WITH NOWAIT;
END TRY
BEGIN CATCH
    DECLARE @ErrorMsg11 NVARCHAR(255) = '   ❌ Error creating IX_Orders_CustomerID index: ' + ERROR_MESSAGE();
    RAISERROR(@ErrorMsg11, 16, 1) WITH NOWAIT;
    THROW;
END CATCH

-- Index on Products.ProductName for search performance
RAISERROR('[INDEX] Creating index: IX_Products_ProductName', 0, 1) WITH NOWAIT;
BEGIN TRY
    CREATE INDEX IX_Products_ProductName ON Products(ProductName);
    RAISERROR('   [OK] Index IX_Products_ProductName created successfully', 0, 1) WITH NOWAIT;
END TRY
BEGIN CATCH
    DECLARE @ErrorMsg12 NVARCHAR(255) = '   ❌ Error creating IX_Products_ProductName index: ' + ERROR_MESSAGE();
    RAISERROR(@ErrorMsg12, 16, 1) WITH NOWAIT;
    THROW;
END CATCH

RAISERROR('[INIT] All performance indexes created successfully', 0, 1) WITH NOWAIT;
PRINT '';
GO

-- =============================================================================
-- 4. CREATE VIEWS FOR TESTING
-- =============================================================================

RAISERROR('[CHECK] Creating database views...', 0, 1) WITH NOWAIT;
GO

-- View combining Products with Category information
RAISERROR('[TABLE] Creating view: ProductsWithCategory', 0, 1) WITH NOWAIT;
GO

IF OBJECT_ID('ProductsWithCategory', 'V') IS NOT NULL
    DROP VIEW ProductsWithCategory;
GO

CREATE VIEW ProductsWithCategory AS
SELECT 
    p.ProductID,
    p.ProductName,
    p.UnitPrice,
    p.UnitsInStock,
    c.CategoryName,
    c.Description as CategoryDescription
FROM Products p
INNER JOIN Categories c ON p.CategoryID = c.CategoryID;
GO

RAISERROR('   [OK] View ProductsWithCategory created successfully', 0, 1) WITH NOWAIT;
GO

-- View for Order Summary
RAISERROR('[TABLE] Creating view: OrderSummary', 0, 1) WITH NOWAIT;
GO

IF OBJECT_ID('OrderSummary', 'V') IS NOT NULL
    DROP VIEW OrderSummary;
GO

CREATE VIEW OrderSummary AS
SELECT 
    o.OrderID,
    o.CustomerID,
    c.CompanyName,
    o.OrderDate,
    COUNT(od.ProductID) as ProductCount,
    SUM(od.UnitPrice * od.Quantity * (1 - od.Discount)) as OrderTotal
FROM Orders o
INNER JOIN Customers c ON o.CustomerID = c.CustomerID
LEFT JOIN [Order Details] od ON o.OrderID = od.OrderID
GROUP BY o.OrderID, o.CustomerID, c.CompanyName, o.OrderDate;
GO

RAISERROR('   [OK] View OrderSummary created successfully', 0, 1) WITH NOWAIT;
RAISERROR('[CHECK] All database views created successfully', 0, 1) WITH NOWAIT;
PRINT '';
GO

-- =============================================================================
-- 5. CREATE STORED PROCEDURES FOR TESTING
-- =============================================================================

RAISERROR('[PROC] Creating stored procedures...', 0, 1) WITH NOWAIT;
GO

-- Procedure to get products by category
RAISERROR('[DATA] Creating stored procedure: GetProductsByCategory', 0, 1) WITH NOWAIT;
GO

IF OBJECT_ID('GetProductsByCategory', 'P') IS NOT NULL
    DROP PROCEDURE GetProductsByCategory;
GO

CREATE PROCEDURE GetProductsByCategory
    @CategoryID int
AS
BEGIN
    SELECT ProductID, ProductName, UnitPrice, UnitsInStock
    FROM Products 
    WHERE CategoryID = @CategoryID
    ORDER BY ProductName;
END;
GO

RAISERROR('   [OK] Stored procedure GetProductsByCategory created successfully', 0, 1) WITH NOWAIT;
GO

-- Procedure to update product stock
RAISERROR('[DATA] Creating stored procedure: UpdateProductStock', 0, 1) WITH NOWAIT;
GO

IF OBJECT_ID('UpdateProductStock', 'P') IS NOT NULL
    DROP PROCEDURE UpdateProductStock;
GO

CREATE PROCEDURE UpdateProductStock
    @ProductID int,
    @NewStock smallint
AS
BEGIN
    UPDATE Products 
    SET UnitsInStock = @NewStock 
    WHERE ProductID = @ProductID;
    
    SELECT @@ROWCOUNT as RowsAffected;
END;
GO

RAISERROR('   [OK] Stored procedure UpdateProductStock created successfully', 0, 1) WITH NOWAIT;
RAISERROR('[PROC] All stored procedures created successfully', 0, 1) WITH NOWAIT;
PRINT '';
GO

-- =============================================================================
-- 6. SETUP PHASE-SPECIFIC DATABASES
-- =============================================================================

RAISERROR('[SETUP] Setting up phase-specific test databases...', 0, 1) WITH NOWAIT;

-- Phase1ReadOnly: Read-only test data
RAISERROR('[PHASE1] Setting up Phase1ReadOnly database...', 0, 1) WITH NOWAIT;
USE Phase1ReadOnly;
RAISERROR('[OK] Switched to Phase1ReadOnly database', 0, 1) WITH NOWAIT;
GO

-- Create consistent table structure (simplified for testing)
RAISERROR('[TABLE] Creating Phase1ReadOnly tables...', 0, 1) WITH NOWAIT;
BEGIN TRY
    IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'Categories')
    BEGIN
        CREATE TABLE Categories (
            CategoryID int IDENTITY(1,1) PRIMARY KEY,
            CategoryName nvarchar(100) NOT NULL,
            Description nvarchar(255) NULL
        );
        RAISERROR('   [OK] Categories table created in Phase1ReadOnly', 0, 1) WITH NOWAIT;
    END
    ELSE
    BEGIN
        RAISERROR('   [SKIP] Categories table already exists in Phase1ReadOnly', 0, 1) WITH NOWAIT;
    END

    IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'Products')
    BEGIN
        CREATE TABLE Products (
            ProductID int IDENTITY(1,1) PRIMARY KEY,
            ProductName nvarchar(100) NOT NULL,
            CategoryID int FOREIGN KEY REFERENCES Categories(CategoryID),
            Price decimal(10,2) NULL,
            Description nvarchar(255) NULL
        );
        RAISERROR('   [OK] Products table created in Phase1ReadOnly', 0, 1) WITH NOWAIT;
    END
    ELSE
    BEGIN
        RAISERROR('   [SKIP] Products table already exists in Phase1ReadOnly', 0, 1) WITH NOWAIT;
    END
END TRY
BEGIN CATCH
    DECLARE @ErrorMsg13 NVARCHAR(255) = '   ❌ Error creating Phase1ReadOnly tables: ' + ERROR_MESSAGE();
    RAISERROR(@ErrorMsg13, 16, 1) WITH NOWAIT;
    THROW;
END CATCH

-- Insert test data
RAISERROR('[DATA] Inserting Phase1ReadOnly test data...', 0, 1) WITH NOWAIT;
BEGIN TRY
    INSERT INTO Categories (CategoryName, Description) VALUES
    ('Electronics', 'Electronic devices and accessories'),
    ('Books', 'Books and reading materials'),
    ('Clothing', 'Apparel and accessories');
    RAISERROR('   [OK] Categories data inserted in Phase1ReadOnly', 0, 1) WITH NOWAIT;

    INSERT INTO Products (ProductName, CategoryID, Price, Description) VALUES
    ('Laptop Computer', 1, 999.99, 'High-performance laptop'),
    ('Programming Guide', 2, 49.99, 'Comprehensive coding manual');
    RAISERROR('   [OK] Products data inserted in Phase1ReadOnly', 0, 1) WITH NOWAIT;
END TRY
BEGIN CATCH
    DECLARE @ErrorMsg14 NVARCHAR(255) = '   ❌ Error inserting Phase1ReadOnly test data: ' + ERROR_MESSAGE();
    RAISERROR(@ErrorMsg14, 16, 1) WITH NOWAIT;
    THROW;
END CATCH

RAISERROR('[PHASE1] Phase1ReadOnly database setup completed successfully', 0, 1) WITH NOWAIT;
PRINT '';
GO

-- Phase2DML: Data manipulation test database
RAISERROR('[PHASE] Setting up Phase2DML database...', 0, 1) WITH NOWAIT;
USE Phase2DML;
RAISERROR('[OK] Switched to Phase2DML database', 0, 1) WITH NOWAIT;
GO

-- Create consistent tables
RAISERROR('[TABLE] Creating Phase2DML tables...', 0, 1) WITH NOWAIT;
BEGIN TRY
    IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'Categories')
    BEGIN
        CREATE TABLE Categories (
            CategoryID int IDENTITY(1,1) PRIMARY KEY,
            CategoryName nvarchar(100) NOT NULL,
            Description nvarchar(255) NULL
        );
        RAISERROR('   [OK] Categories table created in Phase2DML', 0, 1) WITH NOWAIT;
    END
    ELSE
    BEGIN
        RAISERROR('   [SKIP] Categories table already exists in Phase2DML', 0, 1) WITH NOWAIT;
    END

    IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'Products')
    BEGIN
        CREATE TABLE Products (
            ProductID int IDENTITY(1,1) PRIMARY KEY,
            ProductName nvarchar(100) NOT NULL,
            CategoryID int FOREIGN KEY REFERENCES Categories(CategoryID),
            Price decimal(10,2) NULL,
            Description nvarchar(255) NULL
        );
        RAISERROR('   [OK] Products table created in Phase2DML', 0, 1) WITH NOWAIT;
    END
    ELSE
    BEGIN
        RAISERROR('   [SKIP] Products table already exists in Phase2DML', 0, 1) WITH NOWAIT;
    END
END TRY
BEGIN CATCH
    DECLARE @ErrorMsg15 NVARCHAR(255) = '   ❌ Error creating Phase2DML tables: ' + ERROR_MESSAGE();
    RAISERROR(@ErrorMsg15, 16, 1) WITH NOWAIT;
    THROW;
END CATCH

-- Insert test data
RAISERROR('[DATA] Inserting Phase2DML test data...', 0, 1) WITH NOWAIT;
BEGIN TRY
    INSERT INTO Categories (CategoryName, Description) VALUES
    ('Electronics', 'Electronic devices and accessories'),
    ('Books', 'Books and reading materials'),
    ('Clothing', 'Apparel and accessories'),
    ('Food', 'Groceries and beverages'),
    ('Sports', 'Sports equipment and accessories');
    RAISERROR('   [OK] Categories data inserted in Phase2DML', 0, 1) WITH NOWAIT;

    INSERT INTO Products (ProductName, CategoryID, Price, Description) VALUES
    ('Laptop Computer', 1, 999.99, 'High-performance laptop'),
    ('Wireless Mouse', 1, 29.99, 'Ergonomic wireless mouse'),
    ('Programming Guide', 2, 49.99, 'Comprehensive coding manual'),
    ('T-Shirt', 3, 19.99, 'Cotton crew neck shirt'),
    ('Organic Coffee', 4, 15.99, 'Fair trade coffee beans'),
    ('Running Shoes', 5, 89.99, 'Professional running shoes'),
    ('Bluetooth Headphones', 1, 79.99, 'Wireless audio headphones'),
    ('Cookbook', 2, 35.99, 'International recipes'),
    ('Jeans', 3, 59.99, 'Classic fit denim'),
    ('Soccer Ball', 5, 25.99, 'Competition grade ball');
    RAISERROR('   [OK] Products data inserted in Phase2DML', 0, 1) WITH NOWAIT;
END TRY
BEGIN CATCH
    DECLARE @ErrorMsg16 NVARCHAR(255) = '   ❌ Error inserting Phase2DML test data: ' + ERROR_MESSAGE();
    RAISERROR(@ErrorMsg16, 16, 1) WITH NOWAIT;
    THROW;
END CATCH

RAISERROR('[PHASE] Phase2DML database setup completed successfully', 0, 1) WITH NOWAIT;
PRINT '';
GO

-- Phase3DDL: Schema manipulation test database  
RAISERROR('[SETUP] Setting up Phase3DDL database...', 0, 1) WITH NOWAIT;
USE Phase3DDL;
RAISERROR('[OK] Switched to Phase3DDL database', 0, 1) WITH NOWAIT;
GO
GO

-- Create minimal tables for DDL testing
RAISERROR('[TABLE] Creating Phase3DDL tables...', 0, 1) WITH NOWAIT;
BEGIN TRY
    IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'Categories')
    BEGIN
        CREATE TABLE Categories (
            CategoryID int IDENTITY(1,1) PRIMARY KEY,
            CategoryName nvarchar(100) NOT NULL,
            Description nvarchar(255) NULL
        );
        RAISERROR('   [OK] Categories table created in Phase3DDL', 0, 1) WITH NOWAIT;
    END
    ELSE
    BEGIN
        RAISERROR('   [SKIP] Categories table already exists in Phase3DDL', 0, 1) WITH NOWAIT;
    END

    IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'Products')
    BEGIN
        CREATE TABLE Products (
            ProductID int IDENTITY(1,1) PRIMARY KEY,
            ProductName nvarchar(100) NOT NULL,
            CategoryID int FOREIGN KEY REFERENCES Categories(CategoryID),
            Price decimal(10,2) NULL,
            Description nvarchar(255) NULL
        );
        RAISERROR('   [OK] Products table created in Phase3DDL', 0, 1) WITH NOWAIT;
    END
    ELSE
    BEGIN
        RAISERROR('   [SKIP] Products table already exists in Phase3DDL', 0, 1) WITH NOWAIT;
    END
END TRY
BEGIN CATCH
    DECLARE @ErrorMsg17 NVARCHAR(255) = '   ❌ Error creating Phase3DDL tables: ' + ERROR_MESSAGE();
    RAISERROR(@ErrorMsg17, 16, 1) WITH NOWAIT;
    THROW;
END CATCH

-- Insert minimal test data
RAISERROR('[DATA] Inserting Phase3DDL test data...', 0, 1) WITH NOWAIT;
BEGIN TRY
    INSERT INTO Categories (CategoryName, Description) VALUES
    ('Electronics', 'Electronic devices and accessories'),
    ('Books', 'Books and reading materials');
    RAISERROR('   [OK] Categories data inserted in Phase3DDL', 0, 1) WITH NOWAIT;

    INSERT INTO Products (ProductName, CategoryID, Price, Description) VALUES
    ('Test Product 1', 1, 99.99, 'Test product for DDL operations'),
    ('Test Product 2', 2, 29.99, 'Another test product');
    RAISERROR('   [OK] Products data inserted in Phase3DDL', 0, 1) WITH NOWAIT;
END TRY
BEGIN CATCH
    DECLARE @ErrorMsg18 NVARCHAR(255) = '   ❌ Error inserting Phase3DDL test data: ' + ERROR_MESSAGE();
    RAISERROR(@ErrorMsg18, 16, 1) WITH NOWAIT;
    THROW;
END CATCH

RAISERROR('[SETUP] Phase3DDL database setup completed successfully', 0, 1) WITH NOWAIT;
PRINT '';
GO

-- ProtocolTest: Dedicated database for protocol smoke tests
RAISERROR('[PROTO] Setting up ProtocolTest database...', 0, 1) WITH NOWAIT;
USE ProtocolTest;
RAISERROR('[OK] Switched to ProtocolTest database', 0, 1) WITH NOWAIT;
GO

-- Create standard test tables for protocol testing
RAISERROR('[TABLE] Creating ProtocolTest tables...', 0, 1) WITH NOWAIT;
BEGIN TRY
    IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'Categories')
    BEGIN
        CREATE TABLE Categories (
            CategoryID int IDENTITY(1,1) PRIMARY KEY,
            CategoryName nvarchar(100) NOT NULL,
            Description nvarchar(255) NULL
        );
        RAISERROR('   [OK] Categories table created in ProtocolTest', 0, 1) WITH NOWAIT;
    END
    ELSE
    BEGIN
        RAISERROR('   [SKIP] Categories table already exists in ProtocolTest', 0, 1) WITH NOWAIT;
    END

    IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.TABLES WHERE TABLE_NAME = 'Products')
    BEGIN
        CREATE TABLE Products (
            ProductID int IDENTITY(1,1) PRIMARY KEY,
            ProductName nvarchar(100) NOT NULL,
            CategoryID int FOREIGN KEY REFERENCES Categories(CategoryID),
            Price decimal(10,2) NOT NULL DEFAULT 0.00,
            Description nvarchar(255) NULL
        );
        RAISERROR('   [OK] Products table created in ProtocolTest', 0, 1) WITH NOWAIT;
    END
    ELSE
    BEGIN
        RAISERROR('   [SKIP] Products table already exists in ProtocolTest', 0, 1) WITH NOWAIT;
    END
END TRY
BEGIN CATCH
    DECLARE @ErrorMsg19 NVARCHAR(255) = '   ❌ Error creating ProtocolTest tables: ' + ERROR_MESSAGE();
    RAISERROR(@ErrorMsg19, 16, 1) WITH NOWAIT;
    THROW;
END CATCH

-- Insert comprehensive test data for protocol validation
RAISERROR('[DATA] Inserting ProtocolTest test data...', 0, 1) WITH NOWAIT;
BEGIN TRY
    INSERT INTO Categories (CategoryName, Description) VALUES
    ('Electronics', 'Electronic devices and accessories'),
    ('Books', 'Books and reading materials'),
    ('Clothing', 'Apparel and fashion items'),
    ('Home & Garden', 'Home improvement and gardening supplies'),
    ('Sports', 'Sports equipment and gear');
    RAISERROR('   [OK] Categories data inserted in ProtocolTest', 0, 1) WITH NOWAIT;

    INSERT INTO Products (ProductName, CategoryID, Price, Description) VALUES
    ('Laptop Computer', 1, 999.99, 'High-performance laptop'),
    ('Wireless Mouse', 1, 29.99, 'Ergonomic wireless mouse'),
    ('Programming Book', 2, 49.99, 'Learn advanced programming'),
    ('Fiction Novel', 2, 12.99, 'Bestselling fiction novel'),
    ('T-Shirt', 3, 19.99, 'Comfortable cotton t-shirt'),
    ('Jeans', 3, 59.99, 'Classic denim jeans'),
    ('Garden Hose', 4, 39.99, 'Flexible garden hose'),
    ('Plant Pot', 4, 14.99, 'Decorative plant pot'),
    ('Tennis Racket', 5, 89.99, 'Professional tennis racket'),
    ('Basketball', 5, 24.99, 'Official size basketball');
    RAISERROR('   [OK] Products data inserted in ProtocolTest', 0, 1) WITH NOWAIT;
END TRY
BEGIN CATCH
    DECLARE @ErrorMsg20 NVARCHAR(255) = '   ❌ Error inserting ProtocolTest test data: ' + ERROR_MESSAGE();
    RAISERROR(@ErrorMsg20, 16, 1) WITH NOWAIT;
    THROW;
END CATCH

RAISERROR('[PROTO] ProtocolTest database setup completed successfully', 0, 1) WITH NOWAIT;
PRINT '';
GO

-- Return to main database for final setup
USE WarpMcpTest;
GO

-- =============================================================================
-- 7. CREATE TEST USER ACCOUNTS (Optional - for advanced security testing)
-- =============================================================================

-- Note: In containerized environment, we typically use 'sa' account
-- But we can create additional users for specific testing scenarios

/*
-- Read-only user for Phase 1 testing
CREATE LOGIN readonly_user WITH PASSWORD = 'ReadOnly123!';
CREATE USER readonly_user FOR LOGIN readonly_user;

USE Phase1ReadOnly;
ALTER ROLE db_datareader ADD MEMBER readonly_user;

-- DML user for Phase 2 testing  
CREATE LOGIN dml_user WITH PASSWORD = 'DMLUser123!';
CREATE USER dml_user FOR LOGIN dml_user;

USE Phase2DML;
ALTER ROLE db_datareader ADD MEMBER dml_user;
ALTER ROLE db_datawriter ADD MEMBER dml_user;

-- DDL user for Phase 3 testing
CREATE LOGIN ddl_user WITH PASSWORD = 'DDLUser123!';
CREATE USER ddl_user FOR LOGIN ddl_user;

USE Phase3DDL;
ALTER ROLE db_owner ADD MEMBER ddl_user;
*/

-- =============================================================================
-- 7. FINAL VERIFICATION
-- =============================================================================

RAISERROR('[CHECK] Running final verification and reporting...', 0, 1) WITH NOWAIT;
USE WarpMcpTest;
GO

RAISERROR('[INDEX] Verifying main database table counts...', 0, 1) WITH NOWAIT;
BEGIN TRY
    -- Verify table counts
    SELECT 'Categories' as TableName, COUNT(*) as RecordCount FROM Categories
    UNION ALL
    SELECT 'Suppliers', COUNT(*) FROM Suppliers  
    UNION ALL
    SELECT 'Products', COUNT(*) FROM Products
    UNION ALL
    SELECT 'Customers', COUNT(*) FROM Customers
    UNION ALL
    SELECT 'Orders', COUNT(*) FROM Orders
    UNION ALL
    SELECT 'Order Details', COUNT(*) FROM [Order Details];

    -- Verify foreign key relationships
    SELECT 
        'Product-Category Relations' as RelationType,
        COUNT(*) as RelationCount 
    FROM Products p 
    INNER JOIN Categories c ON p.CategoryID = c.CategoryID;
    
    RAISERROR('   [OK] Main database verification completed successfully', 0, 1) WITH NOWAIT;
END TRY
BEGIN CATCH
    DECLARE @ErrorMsg22 NVARCHAR(255) = '   ❌ Error during main database verification: ' + ERROR_MESSAGE();
    RAISERROR(@ErrorMsg22, 16, 1) WITH NOWAIT;
    THROW;
END CATCH

RAISERROR('[CHECK] Verifying phase databases...', 0, 1) WITH NOWAIT;
BEGIN TRY
    -- Verify Phase databases
    USE Phase1ReadOnly;
    SELECT 'Phase1ReadOnly - Categories' as Info, COUNT(*) as Count FROM Categories;
    SELECT 'Phase1ReadOnly - Products' as Info, COUNT(*) as Count FROM Products;

    USE Phase2DML;
    SELECT 'Phase2DML - Categories' as Info, COUNT(*) as Count FROM Categories;
    SELECT 'Phase2DML - Products' as Info, COUNT(*) as Count FROM Products;

    USE Phase3DDL;
    SELECT 'Phase3DDL - Categories' as Info, COUNT(*) as Count FROM Categories;
    SELECT 'Phase3DDL - Products' as Info, COUNT(*) as Count FROM Products;
    
    RAISERROR('   [OK] Phase databases verification completed successfully', 0, 1) WITH NOWAIT;
END TRY
BEGIN CATCH
    DECLARE @ErrorMsg21 NVARCHAR(255) = '   ❌ Error during phase databases verification: ' + ERROR_MESSAGE();
    RAISERROR(@ErrorMsg21, 16, 1) WITH NOWAIT;
    THROW;
END CATCH

USE WarpMcpTest;
GO

RAISERROR('', 0, 1) WITH NOWAIT;
RAISERROR('[DONE] ========================================', 0, 1) WITH NOWAIT;
RAISERROR('[DONE] DATABASE INITIALIZATION COMPLETED SUCCESSFULLY!', 0, 1) WITH NOWAIT;
RAISERROR('[DONE] ========================================', 0, 1) WITH NOWAIT;
RAISERROR('', 0, 1) WITH NOWAIT;
RAISERROR('[TABLE] SUMMARY:', 0, 1) WITH NOWAIT;
RAISERROR('   [DB] Databases created: WarpMcpTest, Phase1ReadOnly, Phase2DML, Phase3DDL, ProtocolTest', 0, 1) WITH NOWAIT;
RAISERROR('   [INDEX] WarpMcpTest data: 8 categories, 5 suppliers, 12 products, 5 customers, 5 orders, 7 order details', 0, 1) WITH NOWAIT;
RAISERROR('   [CHECK] Views created: ProductsWithCategory, OrderSummary', 0, 1) WITH NOWAIT;
RAISERROR('   [PROC] Stored procedures: GetProductsByCategory, UpdateProductStock', 0, 1) WITH NOWAIT;
RAISERROR('   [INIT] Performance indexes created for all foreign keys and search columns', 0, 1) WITH NOWAIT;
RAISERROR('   [PHASE1] Phase1ReadOnly: Read-only test data (2 products, 3 categories)', 0, 1) WITH NOWAIT;
RAISERROR('   [PHASE] Phase2DML: Data manipulation test data (8 products, 5 categories)', 0, 1) WITH NOWAIT;
RAISERROR('   [SETUP] Phase3DDL: Schema manipulation test data (2 products, 2 categories)', 0, 1) WITH NOWAIT;
RAISERROR('   [PROTO] ProtocolTest: Protocol validation test data (10 products, 5 categories)', 0, 1) WITH NOWAIT;
RAISERROR('', 0, 1) WITH NOWAIT;

DECLARE @CompletionTime VARCHAR(50) = '[TIME] Script completed at: ' + CONVERT(varchar, GETDATE(), 120);
RAISERROR(@CompletionTime, 0, 1) WITH NOWAIT;
RAISERROR('[OK] Ready for MCP server testing and validation', 0, 1) WITH NOWAIT;
RAISERROR('', 0, 1) WITH NOWAIT;
GO

-- Create a marker table to indicate that the script has completed
RAISERROR('[FINAL] Creating completion marker...', 0, 1) WITH NOWAIT;
BEGIN TRY
    USE WarpMcpTest;
    IF OBJECT_ID('dbo.InitializationComplete', 'U') IS NOT NULL
        DROP TABLE dbo.InitializationComplete;
    
    CREATE TABLE dbo.InitializationComplete (
        Step nvarchar(100) NOT NULL,
        CompletedAt datetime NOT NULL DEFAULT GETDATE(),
        Version nvarchar(50) DEFAULT 'Enhanced with Error Handling v2.0'
    );
    
    INSERT INTO dbo.InitializationComplete (Step, CompletedAt) 
    VALUES ('init-db.sql', GETDATE());
    
    RAISERROR('[OK] Completion marker created successfully', 0, 1) WITH NOWAIT;
    RAISERROR('', 0, 1) WITH NOWAIT;
    RAISERROR('[INIT] ALL SYSTEMS READY - Database initialization script completed successfully!', 0, 1) WITH NOWAIT;
END TRY
BEGIN CATCH
    DECLARE @ErrorMsg21 NVARCHAR(255) = '❌ Error creating completion marker: ' + ERROR_MESSAGE();
    RAISERROR(@ErrorMsg21, 16, 1) WITH NOWAIT;
    -- Don't throw here as the main initialization is complete
END CATCH
GO
